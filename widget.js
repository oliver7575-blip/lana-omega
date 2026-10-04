/*
 * Lana chat widget for hotel websites.
 * <script src="https://…/widget.js" data-hotel="soiree" defer></script>
 * Styled to match soiree.mx: coral launcher, navy italic serif, warm white.
 * Everything lives in a Shadow DOM so the site's CSS can't affect it.
 */
(function () {
  var script = document.currentScript;
  var slug = script && script.getAttribute('data-hotel');
  var apiBase = script ? script.src.replace(/\/widget\.js.*$/, '') : '';
  if (!slug) {
    console.error('Lana widget: missing data-hotel attribute on the script tag');
    return;
  }

  var ES = /^es/i.test(navigator.language || '');
  var CORAL = '#ee5a4f';
  var NAVY = '#262b6e';

  var storageKey = 'lana-widget-visitor-' + slug;
  var visitorId;
  try {
    visitorId = localStorage.getItem(storageKey);
    if (!visitorId) {
      visitorId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
      localStorage.setItem(storageKey, visitorId);
    }
  } catch (e) {
    visitorId = String(Date.now()) + Math.random().toString(16).slice(2);
  }

  // Serif font for the heading (same family style as the site).
  if (!document.getElementById('lana-widget-font')) {
    var font = document.createElement('link');
    font.id = 'lana-widget-font';
    font.rel = 'stylesheet';
    font.href = 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,500;1,600&display=swap';
    document.head.appendChild(font);
  }

  var host = document.createElement('div');
  host.style.cssText = 'position:fixed;z-index:2147483000;bottom:0;right:0;';
  document.body.appendChild(host);
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

  var ICON_CHAT =
    '<svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true">' +
    '<path d="M16 3.5C8.8 3.5 3 8.6 3 15c0 3.2 1.5 6.1 3.9 8.2L6 28.5l5.4-2.6c1.4.4 3 .6 4.6.6 7.2 0 13-5.1 13-11.5S23.2 3.5 16 3.5Z" fill="#fff"/>' +
    '<path d="M12.3 10.2c.3-.3.8-.3 1 0l1.3 1.6c.3.3.2.8 0 1.1l-.8.8c.6 1.3 1.7 2.5 3 3.1l.8-.8c.3-.3.8-.3 1.1 0l1.6 1.3c.3.3.3.7 0 1l-.9 1c-.6.6-1.5.8-2.3.5-2.8-1-5-3.3-6-6-.3-.8-.1-1.7.5-2.3l.7-.3Z" fill="' + CORAL + '"/>' +
    '</svg>';
  var ICON_CLOSE =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';

  root.innerHTML =
    '<style>' +
    ':host,*{box-sizing:border-box}' +
    '.launch{position:fixed;right:22px;bottom:22px;width:64px;height:64px;border-radius:50%;border:none;cursor:pointer;' +
    'background:' + CORAL + ';display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(0,0,0,.22);transition:transform .15s}' +
    '.launch:hover{transform:scale(1.06)}' +
    '.panel{position:fixed;right:22px;bottom:100px;width:380px;max-width:calc(100vw - 32px);height:580px;max-height:calc(100vh - 130px);' +
    'background:#fbfaf8;border-radius:18px;box-shadow:0 14px 44px rgba(20,24,60,.28);display:none;flex-direction:column;overflow:hidden;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#222}' +
    '.panel.open{display:flex}' +
    '.head{padding:18px 20px 14px;background:#fff;border-bottom:1px solid #eee;display:flex;align-items:center;justify-content:space-between}' +
    '.brand{font-family:"Playfair Display",Georgia,serif;font-style:italic;font-weight:600;font-size:26px;color:' + NAVY + ';line-height:1}' +
    '.sub{margin-top:6px;font-size:12.5px;color:#7a7f93;display:flex;align-items:center;gap:6px}' +
    '.dot{width:7px;height:7px;border-radius:50%;background:#35b876}' +
    '.x{border:none;background:none;cursor:pointer;color:#9aa0b4;font-size:26px;line-height:1;padding:4px}' +
    '.msgs{flex:1;overflow-y:auto;padding:18px 16px 8px}' +
    '.row{display:flex;margin-bottom:10px}' +
    '.row.me{justify-content:flex-end}' +
    '.b{max-width:82%;padding:10px 13px;border-radius:16px;font-size:14.5px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}' +
    '.me .b{background:' + NAVY + ';color:#fff;border-bottom-right-radius:5px}' +
    '.lana .b{background:#efece7;color:#222;border-bottom-left-radius:5px}' +
    '.staff .b{background:#e3f4ea;color:#1d3b2b;border-bottom-left-radius:5px}' +
    '.b a{color:inherit;text-decoration:underline;text-underline-offset:2px}' +
    '.lana .b a,.staff .b a{color:' + CORAL + ';font-weight:600}' +
    '.typing .b{display:flex;gap:4px;align-items:center;padding:13px 14px}' +
    '.typing i{width:6px;height:6px;border-radius:50%;background:#a7a29a;animation:bl 1.2s infinite}' +
    '.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}' +
    '@keyframes bl{0%,80%,100%{opacity:.25}40%{opacity:1}}' +
    '.status{padding:0 16px;font-size:12px;color:#b42318;min-height:0}' +
    '.form{display:flex;gap:8px;align-items:center;padding:12px 14px 14px;background:#fff;border-top:1px solid #eee}' +
    '.in{flex:1;border:1px solid #e1ddd6;border-radius:22px;padding:11px 16px;font-size:15px;outline:none;background:#fbfaf8;color:#222;font-family:inherit}' +
    '.in:focus{border-color:' + NAVY + '}' +
    '.send{width:42px;height:42px;border-radius:50%;border:none;background:' + CORAL + ';cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}' +
    '.send:disabled{opacity:.5;cursor:default}' +
    '.foot{text-align:center;font-size:10.5px;color:#a7aab8;padding:0 0 8px;background:#fff}' +
    '@media (max-width:520px){' +
    '.panel{right:0;bottom:0;width:100vw;max-width:100vw;height:100%;max-height:100%;border-radius:0}' +
    '.panel.open~.launch{display:none}' +
    '.launch{right:16px;bottom:16px;width:58px;height:58px}}' +
    '</style>' +
    '<div class="panel" role="dialog" aria-label="Chat">' +
    '<div class="head"><div><div class="brand">Soirée</div><div class="sub"><span class="dot"></span>' + (ES ? 'Lana · tu concierge' : 'Lana · your concierge') + '</div></div>' +
    '<button class="x" aria-label="Close chat">×</button></div>' +
    '<div class="msgs"></div>' +
    '<div class="status"></div>' +
    '<form class="form"><input class="in" placeholder="' + (ES ? 'Escribe un mensaje…' : 'Write a message…') + '" autocomplete="off" />' +
    '<button class="send" type="submit" aria-label="Send"><svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M3 20.5 21 12 3 3.5l2.6 7.2L14 12l-8.4 1.3L3 20.5Z"/></svg></button></form>' +
    '<div class="foot">Lana · Soirée concierge</div>' +
    '</div>' +
    '<button class="launch" aria-label="Chat with us">' + ICON_CHAT + '</button>';

  var panel = root.querySelector('.panel');
  var launch = root.querySelector('.launch');
  var closeBtn = root.querySelector('.x');
  var msgsEl = root.querySelector('.msgs');
  var statusEl = root.querySelector('.status');
  var formEl = root.querySelector('.form');
  var inputEl = root.querySelector('.in');
  var sendBtn = root.querySelector('.send');

  var waiting = false;
  var lastCount = -1;
  var lastMessages = [];

  function isOpen() {
    return panel.classList.contains('open');
  }
  function toggle(open) {
    panel.classList.toggle('open', open);
    launch.innerHTML = open ? ICON_CLOSE : ICON_CHAT;
    if (open) {
      fetchHistory();
      setTimeout(function () { inputEl.focus(); }, 50);
    }
  }
  launch.addEventListener('click', function () { toggle(!isOpen()); });
  closeBtn.addEventListener('click', function () { toggle(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen()) toggle(false); });

  function setStatus(t) { statusEl.textContent = t || ''; statusEl.style.padding = t ? '0 16px 6px' : '0 16px'; }

  // Text with clickable links (built safely, no HTML injection).
  function fillText(el, text) {
    var re = /(https?:\/\/[^\s<>"')]+)/g;
    var last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = document.createElement('a');
      a.href = m[1];
      a.target = '_blank';
      a.rel = 'noopener';
      var spanish = /\b(el|la|los|las|para|tus|fechas|puedes|aquí|disponibilidad)\b/i.test(text);
      a.textContent = /cloudbeds\.com/i.test(m[1])
        ? (spanish ? 'Ver disponibilidad →' : 'Check availability →')
        : m[1].length > 48 ? m[1].slice(0, 45) + '…' : m[1];
      el.appendChild(a);
      last = m.index + m[1].length;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
  }

  function addRow(kind, text) {
    var row = document.createElement('div');
    row.className = 'row ' + kind;
    var b = document.createElement('div');
    b.className = 'b';
    fillText(b, text.replace(/\*\*?([^*\n]+)\*\*?/g, '$1'));
    row.appendChild(b);
    msgsEl.appendChild(row);
  }

  function render(messages) {
    lastMessages = messages;
    msgsEl.innerHTML = '';
    if (!messages.length) {
      addRow('lana', ES ? '¡Hola! 🌴 Soy Lana, la concierge de Soirée. Pregúntame lo que quieras sobre tu estancia o Zipolite.' : 'Hi! 🌴 I\'m Lana, Soirée\'s concierge. Ask me anything about your stay or Zipolite.');
    }
    messages.forEach(function (m) {
      if (!m.content || /^\[.*\]$/.test(m.content.trim())) return;
      addRow(m.sender_type === 'guest' ? 'me' : m.sender_type === 'staff' ? 'staff' : 'lana', m.content);
    });
    if (waiting) {
      var t = document.createElement('div');
      t.className = 'row lana typing';
      t.innerHTML = '<div class="b"><i></i><i></i><i></i></div>';
      msgsEl.appendChild(t);
    }
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function fetchHistory() {
    fetch(apiBase + '/api/widget/' + slug + '/chat?visitorId=' + encodeURIComponent(visitorId))
      .then(function (r) { if (!r.ok) throw new Error('history'); return r.json(); })
      .then(function (j) {
        var ms = j.messages || [];
        if (ms.length !== lastCount || waiting) { lastCount = ms.length; render(ms); }
        setStatus('');
      })
      .catch(function () { if (!statusEl.textContent && !waiting) setStatus('Having trouble connecting. Retrying…'); });
  }

  formEl.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = inputEl.value.trim();
    if (!text || waiting) return;
    inputEl.value = '';
    sendBtn.disabled = true;
    setStatus('');
    waiting = true;
    var before = lastMessages;
    render(before.concat([{ sender_type: 'guest', content: text }]));

    fetch(apiBase + '/api/widget/' + slug + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId: visitorId, message: text }),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
          return j;
        });
      })
      .then(function () { waiting = false; lastCount = -1; fetchHistory(); })
      .catch(function (err) {
        waiting = false;
        inputEl.value = text;
        render(before);
        setStatus(err.message || 'Something went wrong. Please try again.');
      })
      .finally(function () { sendBtn.disabled = false; inputEl.focus(); });
  });

  setInterval(function () { if (isOpen() && !waiting) fetchHistory(); }, 4000);
})();
