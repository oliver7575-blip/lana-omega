(function () {
  const script = document.currentScript;
  const slug = script.getAttribute('data-hotel');
  const apiBase = script.src.replace('/widget.js', '');

  if (!slug) {
    console.error('Lana widget: missing data-hotel attribute on the script tag');
    return;
  }

  const storageKey = 'lana-widget-visitor-' + slug;
  let visitorId = localStorage.getItem(storageKey);
  if (!visitorId) {
    visitorId = crypto.randomUUID();
    localStorage.setItem(storageKey, visitorId);
  }

  const bubble = document.createElement('button');
  bubble.textContent = '💬';
  bubble.style.cssText =
    'position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;' +
    'background:#1e3a8a;color:white;border:none;font-size:24px;cursor:pointer;' +
    'box-shadow:0 2px 8px rgba(0,0,0,0.2);z-index:999998;';
  document.body.appendChild(bubble);

  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;bottom:88px;right:20px;width:320px;height:420px;background:white;' +
    'border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.2);display:none;flex-direction:column;' +
    'font-family:-apple-system,sans-serif;overflow:hidden;z-index:999999;';
  panel.innerHTML =
    '<div style="background:#1e3a8a;color:white;padding:12px 16px;font-weight:600;">Chat with us</div>' +
    '<div id="lana-messages" style="flex:1;overflow-y:auto;padding:12px;font-size:14px;"></div>' +
    '<div id="lana-status" style="padding:0 12px;font-size:12px;color:#b91c1c;"></div>' +
    '<form id="lana-form" style="display:flex;border-top:1px solid #eee;">' +
    '<input id="lana-input" placeholder="Type a message..." style="flex:1;border:none;padding:10px;font-size:14px;outline:none;" />' +
    '<button type="submit" id="lana-send-btn" style="border:none;background:#1e3a8a;color:white;padding:0 16px;cursor:pointer;">Send</button>' +
    '</form>';
  document.body.appendChild(panel);

  const messagesEl = panel.querySelector('#lana-messages');
  const statusEl = panel.querySelector('#lana-status');
  const formEl = panel.querySelector('#lana-form');
  const inputEl = panel.querySelector('#lana-input');
  const sendBtn = panel.querySelector('#lana-send-btn');

  bubble.addEventListener('click', function () {
    panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    if (panel.style.display === 'flex') fetchHistory();
  });

  function setStatus(text) {
    statusEl.textContent = text || '';
  }

  function renderMessages(messages) {
    messagesEl.innerHTML = '';
    messages.forEach(function (m) {
      const row = document.createElement('div');
      row.style.cssText =
        'margin-bottom:8px;text-align:' + (m.sender_type === 'guest' ? 'right' : 'left') + ';';
      const bubbleEl = document.createElement('div');
      const bg =
        m.sender_type === 'guest' ? '#dbeafe' : m.sender_type === 'staff' ? '#dcfce7' : '#f0f0f0';
      bubbleEl.style.cssText =
        'display:inline-block;padding:8px 10px;border-radius:8px;max-width:80%;' +
        'background:' + bg + ';white-space:pre-wrap;text-align:left;';
      bubbleEl.textContent = m.content;
      row.appendChild(bubbleEl);
      messagesEl.appendChild(row);
    });
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function fetchHistory() {
    fetch(apiBase + '/api/widget/' + slug + '/chat?visitorId=' + visitorId)
      .then(function (res) {
        if (!res.ok) throw new Error('history-fetch-failed');
        return res.json();
      })
      .then(function (json) {
        renderMessages(json.messages || []);
        setStatus('');
      })
      .catch(function () {
        // Don't overwrite an active send-error message with a silent
        // background-poll failure — only surface this if nothing else is
        // already shown.
        if (!statusEl.textContent) {
          setStatus('Having trouble loading this conversation. Retrying...');
        }
      });
  }

  formEl.addEventListener('submit', function (e) {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;

    inputEl.value = '';
    inputEl.disabled = true;
    sendBtn.disabled = true;
    setStatus('');

    fetch(apiBase + '/api/widget/' + slug + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId: visitorId, message: text }),
    })
      .then(function (res) {
        return res.json().then(function (json) {
          if (!res.ok) {
            throw new Error(json.error || 'Something went wrong. Please try again.');
          }
          return json;
        });
      })
      .then(function () {
        fetchHistory();
      })
      .catch(function (err) {
        // Put the failed text back in the input so nothing the visitor
        // typed is silently lost, and show exactly why it failed (e.g. the
        // real rate-limit message) instead of nothing at all.
        inputEl.value = text;
        setStatus(err.message || 'Something went wrong. Please try again.');
      })
      .finally(function () {
        inputEl.disabled = false;
        sendBtn.disabled = false;
      });
  });

  setInterval(function () {
    if (panel.style.display === 'flex') fetchHistory();
  }, 4000);
})();
