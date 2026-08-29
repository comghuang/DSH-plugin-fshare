import { execFile } from 'node:child_process'

const EXTRA_ROOTS = []
const MAX_BYTES = 64 * 1024 * 1024
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8', csv: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8', zip: 'application/zip',
}
const INLINE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'pdf', 'txt', 'md', 'json', 'csv', 'log'])
const IMG = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'])

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

// ── 机器状态采样（CPU / 内存 / 磁盘 / GPU）─────────────────────────────
// 采样通过 node:child_process 直接执行 powershell（不受 fs 服务限制）。
// 注意：脚本保持 ASCII（避免 Windows argv 编码问题）。
const STATUS_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$cpu = (Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Measure-Object -Property LoadPercentage -Average).Average',
  '$os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue',
  '$ramTotal = [math]::Round($os.TotalVisibleMemorySize / 1024, 0)',
  '$ramFree = [math]::Round($os.FreePhysicalMemory / 1024, 0)',
  '$disks = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ name = $_.DeviceID; total = [math]::Round($_.Size/1GB,1); free = [math]::Round($_.FreeSpace/1GB,1) } })',
  '$gpu = $null',
  '$nv = Get-Command nvidia-smi -ErrorAction SilentlyContinue',
  'if ($nv) { try { $raw = & nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits; $parts = ($raw | Select-Object -First 1) -split ","; if ($parts.Count -ge 4) { $gpu = [pscustomobject]@{ util = [int]$parts[0].Trim(); memUsed = [int]$parts[1].Trim(); memTotal = [int]$parts[2].Trim(); temp = [int]$parts[3].Trim() } } } catch { $gpu = $null } }',
  '[pscustomobject]@{ cpu = if ($null -eq $cpu) { -1 } else { [math]::Round($cpu,1) }; memPct = if ($ramTotal -gt 0) { [math]::Round(100 * (1 - $ramFree / $ramTotal),1) } else { -1 }; memUsedMB = $ramTotal - $ramFree; memTotalMB = $ramTotal; disks = @($disks); gpu = $gpu } | ConvertTo-Json -Depth 4 -Compress',
].join('\n')

const runPs = (script, timeoutMs = 15000) => new Promise((resolve, reject) => {
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  }, (err, stdout, stderr) => {
    if (err) reject(new Error(String(stderr || err.message).slice(0, 500)))
    else resolve(String(stdout).trim())
  })
})

let statusCache = { at: 0, value: null }
let statusInflight = null
const getStatus = async () => {
  const now = Date.now()
  if (statusCache.value !== null && now - statusCache.at < 3000) return statusCache.value
  if (statusInflight !== null) return statusInflight
  statusInflight = (async () => {
    try {
      const raw = await runPs(STATUS_SCRIPT)
      const value = JSON.parse(raw)
      statusCache = { at: Date.now(), value }
      return value
    } finally {
      statusInflight = null
    }
  })()
  return statusInflight
}

export default {
  name: 'dsh-plugin-fshare',
  apply(ctx) {
    const webServer = ctx.get('webServer')
    const fs = ctx.get('fs')
    const sessions = ctx.get('sessions')
    const sandboxPolicy = ctx.get('sandboxPolicy')
    if (webServer === undefined || fs === undefined) return
    const defaultRoot = sandboxPolicy !== undefined && sandboxPolicy.workspaceRoot ? sandboxPolicy.workspaceRoot : ''

    // 会话工作区根 + 可配置白名单（EXTRA_ROOTS，绝对路径字符串数组）。
    // 修改此常量后重启 dsh --profile web 生效。
    const cwdOf = (sid) => {
      try {
        if (sessions !== undefined && typeof sid === 'string' && sid !== '') {
          const s = sessions.get(sid)
          if (s !== undefined && s.header !== undefined && typeof s.header.cwd === 'string' && s.header.cwd !== '') return s.header.cwd
        }
      } catch (e) { /* fall through */ }
      return defaultRoot
    }
    const rootsFor = (sid) => {
      const arr = []
      const c = cwdOf(sid)
      if (c) arr.push(c)
      for (const r of EXTRA_ROOTS) arr.push(r)
      return arr
    }
    const b64u = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const unb64u = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')

    const safeRel = (rel) => {
      const norm = String(rel).replace(/\\/g, '/')
      if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) throw new Error('absolute path not allowed')
      const parts = norm.split('/').filter(Boolean)
      if (parts.indexOf('..') >= 0) throw new Error('parent traversal not allowed')
      return norm
    }
    const resolveIn = async (roots, rootPath, rel) => {
      const base = await fs.resolve(rootPath)
      let target = base
      if (rel !== undefined && rel !== '') target = await fs.resolve(safeRel(rel), { cwd: rootPath })
      let ok = false
      for (const r of roots) {
        const p = await fs.resolve(r)
        if (fs.contains(p, target)) { ok = true; break }
      }
      if (!ok) throw new Error('outside allowed roots')
      return target
    }
    const parseQuery = (u) => {
      const i = u.indexOf('?')
      const qs = i >= 0 ? u.slice(i + 1) : ''
      const out = {}
      for (const part of qs.split('&')) {
        if (!part) continue
        const eq = part.indexOf('=')
        const k = decodeURIComponent(eq >= 0 ? part.slice(0, eq) : part)
        out[k] = eq >= 0 ? decodeURIComponent(part.slice(eq + 1)) : ''
      }
      return out
    }

    const doList = async (sid, root, rel) => {
      const roots = rootsFor(sid)
      if (roots.length === 0) return { error: 'no workspace root' }
      if (!roots[root]) return { error: 'unknown root' }
      const target = await resolveIn(roots, roots[root], rel)
      const info = await fs.stat(target)
      if (!info || info.type !== 'directory') return { error: 'not a directory' }
      const entries = await fs.listDir(target)
      const prefix = rel ? String(rel).replace(/\\/g, '/').replace(/\/+$/, '') + '/' : ''
      const out = []
      for (const e of entries) {
        const ext = (String(e.name).split('.').pop() || '').toLowerCase()
        const isDir = e.type === 'directory'
        const token = b64u(JSON.stringify([sid, root, prefix + e.name]))
        out.push({
          name: e.name,
          dir: isDir,
          size: isDir ? 0 : (e.size || 0),
          kind: IMG.has(ext) ? 'image' : (ext === 'pdf' ? 'pdf' : 'other'),
          url: isDir ? '' : '/fshare/f/' + token,
        })
      }
      out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : (a.dir ? -1 : 1)))
      return { rootLabel: roots[root], path: rel, entries: out }
    }

    const doSearch = async (sid, root, rel, q0) => {
      const roots = rootsFor(sid)
      if (roots.length === 0) return { error: 'no workspace root' }
      if (!roots[root]) return { error: 'unknown root' }
      const q = String(q0 || '').toLowerCase()
      if (q === '') return { entries: [], truncated: false }
      const start = await resolveIn(roots, roots[root], rel)
      const info = await fs.stat(start)
      if (!info || info.type !== 'directory') return { error: 'not a directory' }
      const MAX_NODES = 4000
      const MAX_DEPTH = 8
      const MAX_RESULTS = 200
      const queue = [{ target: start, rel: '', depth: 0 }]
      const visited = new Set()
      if (start.targetKey !== undefined) visited.add(start.targetKey)
      let nodes = 0
      let truncated = false
      const out = []
      outer: while (queue.length > 0) {
        const cur = queue.shift()
        if (cur.depth > MAX_DEPTH) continue
        let sub = []
        try { sub = await fs.listDir(cur.target) } catch (e) { continue }
        for (const e of sub) {
          nodes++
          if (nodes > MAX_NODES) { truncated = true; break outer }
          const p = cur.rel ? cur.rel + '/' + e.name : e.name
          const ext = (String(e.name).split('.').pop() || '').toLowerCase()
          if (e.type === 'directory') {
            if (e.target && e.target.targetKey !== undefined && !visited.has(e.target.targetKey)) {
              visited.add(e.target.targetKey)
              queue.push({ target: e.target, rel: p, depth: cur.depth + 1 })
            }
            if (String(e.name).toLowerCase().indexOf(q) >= 0) {
              out.push({ name: e.name, dir: true, path: p, size: 0, kind: 'other', url: '' })
            }
          } else if (String(e.name).toLowerCase().indexOf(q) >= 0) {
            out.push({
              name: e.name, dir: false, path: p, size: e.size || 0,
              kind: IMG.has(ext) ? 'image' : (ext === 'pdf' ? 'pdf' : 'other'),
              url: '/fshare/f/' + b64u(JSON.stringify([sid, root, p])),
            })
            if (out.length >= MAX_RESULTS) { truncated = true; break outer }
          }
        }
      }
      return { entries: out, truncated: truncated }
    }

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/fshare/api',
      handler: async (req, res) => {
        try {
          const q = parseQuery(String(req.url || ''))
          const sid = q.sessionId || ''
          const root = Number(q.root) || 0
          const op = q.op
          let out
          if (op === 'list') out = await doList(sid, root, q.path || '')
          else if (op === 'search') out = await doSearch(sid, root, q.path || '', q.query || '')
          else if (op === 'status') out = await getStatus()
          else { sendJson(res, 400, { error: 'bad op' }); return }
          sendJson(res, 200, out)
        } catch (err) {
          sendJson(res, 500, { error: String((err && err.message) || err) })
        }
      },
    }))

    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/fshare/f',
      handler: async (req, res) => {
        try {
          const u = String(req.url || '')
          const i = u.indexOf('?')
          const pathname = i >= 0 ? u.slice(0, i) : u
          const query = i >= 0 ? u.slice(i + 1) : ''
          const token = pathname.slice('/fshare/f/'.length)
          const dl = /(^|&)dl=1(&|$)/.test(query)
          const raw = JSON.parse(unb64u(token))
          if (!Array.isArray(raw) || raw.length < 3 || typeof raw[0] !== 'string' || typeof raw[1] !== 'number') throw new Error('bad token')
          const sid = raw[0]
          const root = raw[1]
          const rel = String(raw[2])
          const roots = rootsFor(sid)
          if (!roots[root]) throw new Error('unknown root')
          const target = await resolveIn(roots, roots[root], rel)
          const info = await fs.stat(target)
          if (!info || info.type !== 'file') { res.writeHead(404); res.end('not found'); return }
          const size = info.size || 0
          if (size > MAX_BYTES) { res.writeHead(413); res.end('too large'); return }
          const bytes = await fs.readBytes(target, undefined, MAX_BYTES)
          const name = rel.split('/').pop() || 'file'
          const ext = (String(name).split('.').pop() || '').toLowerCase()
          const inline = !dl && INLINE.has(ext)
          const safeName = String(name).replace(/[^\w.\- ]+/g, '_')
          res.writeHead(200, {
            'Content-Type': inline ? (MIME[ext] || 'application/octet-stream') : 'application/octet-stream',
            'Content-Disposition': (inline ? 'inline' : 'attachment') + '; filename="' + safeName + '"',
            'Content-Length': String(bytes.length),
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          })
          res.end(bytes)
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end(String((err && err.message) || err))
        }
      },
    }))
  },
}
