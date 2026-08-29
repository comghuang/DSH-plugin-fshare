window.__ModuleLoader__.load({
  id: 'dsh-plugin-fshare',
  factory: function (require) {
    var module = { exports: {} }
    var React = require('react')

    function fmtSize(n) {
      if (!n) return '0 B'
      if (n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
      return (n / 1024 / 1024).toFixed(1) + ' MB'
    }

    function FshareDock(props) {
      var sessionId = String((props && props.sessionId) || '')
      var opened = React.useState(false)
      var path = React.useState('')
      var data = React.useState(null)
      var err = React.useState('')
      var loading = React.useState(false)
      var sel = React.useState(null)
      var query = React.useState('')
      var search = React.useState(null)
      var setOpened = opened[1]
      var setPath = path[1]
      var setData = data[1]
      var setErr = err[1]
      var setLoading = loading[1]
      var setSel = sel[1]
      var setQuery = query[1]
      var setSearch = search[1]
      var pathValue = path[0]
      var dataValue = data[0]
      var loadingValue = loading[0]
      var searchValue = search[0]
      var queryValue = query[0]

      var apiCall = function (params) {
        var qs = ''
        for (var k in params) {
          if (!Object.prototype.hasOwnProperty.call(params, k)) continue
          qs += (qs ? '&' : '') + encodeURIComponent(k) + '=' + encodeURIComponent(params[k])
        }
        return fetch('/fshare/api?' + qs).then(function (r) { return r.json() })
      }

      var load = function (p) {
        setLoading(true)
        apiCall({ op: 'list', sessionId: sessionId, path: p || '' }).then(function (res) {
          if (res && res.error) { setErr('加载失败：' + res.error); setData(null) } else { setErr(''); setData(res) }
        }).catch(function (e) { setErr('连接失败：' + String((e && e.message) || e)); setData(null) }).then(function () { setLoading(false) })
      }

      var runSearch = function () {
        var q = queryValue.trim()
        if (!q) { setSearch(null); return }
        setSearch({ q: q, entries: [], truncated: false, loading: true, error: '' })
        apiCall({ op: 'search', sessionId: sessionId, path: pathValue, query: q }).then(function (res) {
          if (res && res.error) setSearch({ q: q, entries: [], truncated: false, loading: false, error: String(res.error) })
          else setSearch({ q: q, entries: (res && res.entries) || [], truncated: !!(res && res.truncated), loading: false, error: '' })
        }).catch(function (e) { setSearch({ q: q, entries: [], truncated: false, loading: false, error: '连接失败' }) })
      }

      var toggle = function () {
        var next = !opened[0]
        setOpened(next)
        if (next && dataValue === null && !loadingValue) load(pathValue)
      }
      var refresh = function () { if (searchValue) runSearch(); else load(pathValue) }
      var navigate = function (p) { setPath(p); setSel(null); setSearch(null); load(p) }
      var enter = function (name) { navigate(pathValue ? pathValue + '/' + name : name) }
      var up = function () { var parts = pathValue.split('/'); parts.pop(); navigate(parts.join('/')) }
      var openResultDir = function (p) { navigate(p) }

      var items = (dataValue && dataValue.entries) || []
      var summary = dataValue ? (items.length + ' 项' + (pathValue ? ' · ' + pathValue : ' · 根目录')) : '点击展开浏览结果文件'

      var makeItem = function (e, scopeKey) {
        var title = e.dir ? e.path : (e.path && e.path !== e.name ? e.path + ' · ' + e.name : e.name)
        if (e.dir) {
          return React.createElement('button', { key: scopeKey + e.path, className: 'fshare-chip', onClick: function () { openResultDir(e.path) }, title: title }, '📁 ' + e.name)
        }
        if (e.kind === 'image') {
          return React.createElement('a', {
            key: scopeKey + e.path, className: 'fshare-thumb', href: e.url, target: '_blank', rel: 'noreferrer',
            title: title, onClick: function (ev) { ev.preventDefault(); setSel(e) },
          }, React.createElement('img', { src: e.url, alt: e.name, loading: 'lazy' }))
        }
        var label = (e.kind === 'pdf' ? '📄 ' : '📎 ') + e.name + ' (' + fmtSize(e.size) + ')'
        if (e.kind === 'pdf') {
          return [
            React.createElement('a', {
              key: scopeKey + e.path + ':o', className: 'fshare-chip', href: e.url, target: '_blank', rel: 'noreferrer', title: title,
            }, label),
            React.createElement('a', {
              key: scopeKey + e.path + ':dl', className: 'fshare-btn', href: e.url + '?dl=1', download: e.name,
            }, '下载'),
          ]
        }
        return React.createElement('a', {
          key: scopeKey + e.path, className: 'fshare-chip', href: e.url + '?dl=1', download: e.name, title: title,
        }, label)
      }

      var bar = []
      bar.push(React.createElement('button', {
        key: 'refresh', className: 'fshare-btn', disabled: !!loadingValue || !!(searchValue && searchValue.loading), onClick: refresh,
      }, loadingValue || (searchValue && searchValue.loading) ? '刷新中…' : '↻ 刷新'))
      bar.push(React.createElement('button', {
        key: 'up', className: 'fshare-btn', disabled: pathValue === '', onClick: up,
      }, '⬆ 上级'))
      bar.push(React.createElement('span', { key: 'path', className: 'fshare-path' },
        (dataValue && dataValue.rootLabel ? dataValue.rootLabel : '') + (pathValue ? ' / ' + pathValue : '')))
      bar.push(React.createElement('span', { key: 'count', className: 'fshare-count' }, items.length + ' 项'))

      if (searchValue) {
        if (searchValue.error) {
          bar.push(React.createElement('span', { key: 'serr', className: 'fshare-err' }, '搜索失败：' + searchValue.error))
        } else {
          bar.push(React.createElement('span', { key: 'shead', className: 'fshare-count' },
            '搜索“' + searchValue.q + '”：' + (searchValue.loading ? '搜索中…' : searchValue.entries.length + ' 项' + (searchValue.truncated ? '（已截断）' : ''))))
          for (var si = 0; si < searchValue.entries.length; si++) {
            var sm = makeItem(searchValue.entries[si], 's:')
            if (Array.isArray(sm)) { for (var sc = 0; sc < sm.length; sc++) bar.push(sm[sc]) } else bar.push(sm)
          }
          if (!searchValue.loading && searchValue.entries.length === 0) bar.push(React.createElement('span', { key: 'snone', className: 'fshare-empty' }, '未找到匹配文件'))
        }
      } else {
        for (var di = 0; di < items.length; di++) {
          var dm = makeItem(items[di], 'd:')
          if (Array.isArray(dm)) { for (var dc = 0; dc < dm.length; dc++) bar.push(dm[dc]) } else bar.push(dm)
        }
        if (items.length === 0 && !err[0]) bar.push(React.createElement('span', { key: 'empty', className: 'fshare-empty' }, '暂无文件或目录'))
      }

      var body = null
      if (opened[0]) {
        body = React.createElement('div', { className: 'fshare-body' },
          React.createElement('div', { className: 'fshare-search' },
            React.createElement('input', {
              key: 'q', className: 'fshare-input', value: queryValue, placeholder: '搜索文件名（含子目录，回车搜索）',
              onChange: function (ev) { setQuery(ev.target.value) },
              onKeyDown: function (ev) { if (ev.key === 'Enter') runSearch() },
            }),
            React.createElement('button', {
              key: 'go', className: 'fshare-btn', disabled: queryValue.trim() === '' || !!(searchValue && searchValue.loading), onClick: runSearch,
            }, '搜索'),
            searchValue ? React.createElement('button', {
              key: 'clr', className: 'fshare-btn', onClick: function () { setSearch(null); setQuery('') },
            }, '✕ 清除') : null),
          React.createElement('div', { className: 'fshare-bar' }, bar),
          err[0] && !searchValue ? React.createElement('div', { className: 'fshare-err' }, err[0]) : null,
          sel[0] ? React.createElement('div', { className: 'fshare-preview' },
            React.createElement('a', { href: sel[0].url, target: '_blank', rel: 'noreferrer' },
              React.createElement('img', { className: 'fshare-big', src: sel[0].url, alt: sel[0].name })),
            React.createElement('div', { className: 'fshare-preview-bar' },
              React.createElement('span', { className: 'fshare-pv-name' }, sel[0].name + (sel[0].path && sel[0].path !== sel[0].name ? ' · ' + sel[0].path : '')),
              React.createElement('a', { className: 'fshare-btn', href: sel[0].url + '?dl=1', download: sel[0].name }, '下载'),
              React.createElement('a', { className: 'fshare-btn', href: sel[0].url, target: '_blank', rel: 'noreferrer' }, '新窗口打开'),
              React.createElement('button', { className: 'fshare-btn', onClick: function () { setSel(null) } }, '关闭预览')))
            : null)
      }

      return React.createElement('div', { className: 'fshare-dock' },
        React.createElement('button', {
          className: 'fshare-head', onClick: toggle,
          title: opened[0] ? '收起文件面板' : '展开文件面板',
        },
          React.createElement('span', { className: 'fshare-lead' }, '📁'),
          React.createElement('span', { className: 'fshare-title' }, '文件'),
          React.createElement('span', { className: 'fshare-summary' }, summary),
          React.createElement('span', { className: 'fshare-chev' + (opened[0] ? ' fshare-chev-open' : '') }, '▾')),
        body)
    }

    function injectCss() {
      if (typeof document === 'undefined') return
      var id = 'dsh-plugin-fshare'
      if (document.querySelector('style[data-plugin-css="' + id + '"]')) return
      var tag = document.createElement('style')
      tag.setAttribute('data-plugin-css', id)
      tag.textContent = '.fshare-dock { box-sizing: border-box; width: calc(100% - 2 * var(--dsh-composer-side-clearance, 16px) - 2 * var(--dsh-composer-dock-inset, 8px)); max-width: calc(var(--dsh-composer-card-max-width, 780px) - 2 * var(--dsh-composer-dock-inset, 8px)); margin: 0 auto 6px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-specific-tip, var(--dsw-alias-bg-layer-1)); border-radius: 12px; overflow: hidden; color: var(--dsw-alias-label-primary); font-size: 12px; }\n.fshare-head { box-sizing: border-box; width: 100%; height: 36px; display: flex; align-items: center; gap: 10px; padding: 4px 12px; background: transparent; border: none; color: inherit; cursor: pointer; text-align: left; font: inherit; }\n.fshare-head:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }\n.fshare-lead { color: var(--dsw-alias-label-secondary); display: inline-flex; place-items: center; }\n.fshare-title { color: var(--dsw-alias-label-primary); font-weight: 500; font-size: 13px; flex: none; }\n.fshare-summary { min-width: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; flex: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.fshare-chev { color: var(--dsw-alias-label-secondary); flex: none; display: inline-flex; transition: transform 0.12s; }\n.fshare-chev-open { transform: rotate(180deg); }\n.fshare-body { display: flex; flex-direction: column; gap: 6px; padding: 4px 10px 10px; }\n.fshare-search { display: flex; align-items: center; gap: 6px; }\n.fshare-input { box-sizing: border-box; flex: 1; min-width: 0; height: 28px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12px; outline: none; }\n.fshare-input:focus { border-color: var(--dsw-alias-brand-primary); }\n.fshare-input::placeholder { color: var(--dsw-alias-label-secondary); }\n.fshare-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }\n.fshare-btn { padding: 2px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 12px; line-height: 20px; text-decoration: none; }\n.fshare-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }\n.fshare-btn:disabled { opacity: 0.5; cursor: default; }\n.fshare-chip { display: inline-flex; align-items: center; gap: 2px; padding: 3px 10px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); border: none; cursor: pointer; font-size: 12px; text-decoration: none; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.fshare-chip:hover { color: var(--dsw-alias-label-primary); }\n.fshare-thumb { display: inline-block; width: 64px; height: 64px; border-radius: 8px; overflow: hidden; border: 1px solid var(--dsw-alias-border-l1); transition: border-color 0.12s; }\n.fshare-thumb:hover { border-color: var(--dsw-alias-brand-primary); }\n.fshare-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }\n.fshare-path { color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40%; }\n.fshare-count { color: var(--dsw-alias-label-secondary); }\n.fshare-err { color: var(--dsw-alias-state-error-primary); }\n.fshare-empty { color: var(--dsw-alias-label-secondary); }\n.fshare-preview { text-align: center; }\n.fshare-big { max-width: 100%; max-height: 320px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); }\n.fshare-preview-bar { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-items: center; margin-top: 6px; }\n.fshare-pv-name { max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); }'
      document.head.appendChild(tag)
    }

    var inject = ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-conversation']
    function apply(ctx) {
      injectCss()
      var slots = ctx.get('slots')
      if (slots === undefined) return
      ctx.effect(function () {
        return slots.inject('conversation.input.dock', function () {
          return slots.register({
            name: 'conversation.input.dock', id: 'fshare', order: 12, label: '文件',
          }, function (props) { return React.createElement(FshareDock, props) })
        })
      })
    }
    module.exports = { inject: inject, apply: apply }
    return module.exports
  },
})
