// client.js — Полная клиентская логика К.ФриРунет 2.0

const socket = io();

// ========== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ==========
let currentUser = null;        // объект профиля
let currentRoomId = 'general'; // ID активной комнаты
let currentMessages = [];      // сообщения текущей комнаты
let roomParticipants = [];     // участники текущей комнаты
let recentSearches = JSON.parse(localStorage.getItem('kfr_recentSearches') || '[]');

// ========== DOM-ЭЛЕМЕНТЫ ==========
const authOverlay = document.getElementById('authOverlay');
const mainApp = document.getElementById('mainApp');
const messagesContainer = document.getElementById('messagesContainer');
const chatHeader = document.getElementById('chatHeader');
const messageInput = document.getElementById('messageInput');
const participantsList = document.getElementById('participantsList');
const subBtnContainer = document.getElementById('subBtnContainer');
const displayUserId = document.getElementById('displayUserId');
const inputNickname = document.getElementById('inputNickname');
const inputDescription = document.getElementById('inputDescription');
const colorPalette = document.getElementById('colorPalette');
const avatarFile = document.getElementById('avatarFile');
const avatarPreview = document.getElementById('avatarPreview');
const bgFile = document.getElementById('bgFile');
const themeSelect = document.getElementById('themeSelect');

// ========== АВТОРИЗАЦИЯ ==========
let authMode = 'login'; // login | register
document.getElementById('tabLogin').addEventListener('click', () => {
  authMode = 'login';
  document.getElementById('tabLogin').classList.add('active');
  document.getElementById('tabRegister').classList.remove('active');
  document.getElementById('registerNickField').classList.add('hidden');
  document.getElementById('authSubmit').textContent = 'Войти';
});
document.getElementById('tabRegister').addEventListener('click', () => {
  authMode = 'register';
  document.getElementById('tabRegister').classList.add('active');
  document.getElementById('tabLogin').classList.remove('active');
  document.getElementById('registerNickField').classList.remove('hidden');
  document.getElementById('authSubmit').textContent = 'Зарегистрироваться';
});

document.getElementById('authForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const login = document.getElementById('authLogin').value.trim();
  const password = document.getElementById('authPassword').value;
  const nick = document.getElementById('authNick').value.trim();
  document.getElementById('authError').textContent = '';
  if (authMode === 'register') {
    socket.emit('register', { login, password, nick });
  } else {
    socket.emit('login', { login, password });
  }
});

socket.on('authError', (msg) => {
  document.getElementById('authError').textContent = msg;
});

socket.on('authSuccess', (profile) => {
  currentUser = profile;
  localStorage.setItem('kfr_userId', profile.id);
  applyUserSettings(profile);
  authOverlay.classList.add('hidden');
  mainApp.classList.remove('hidden');
  joinRoom('general');
});

// ========== ПРИМЕНЕНИЕ НАСТРОЕК ПОЛЬЗОВАТЕЛЯ ==========
function applyUserSettings(profile) {
  document.body.className = profile.theme === 'light' ? 'light' : '';
  themeSelect.value = profile.theme;
  if (profile.background) {
    document.body.style.backgroundImage = `url(/backgrounds/${profile.background})`;
  } else {
    document.body.style.backgroundImage = '';
  }
  inputNickname.value = profile.nick;
  inputDescription.value = profile.description || '';
  displayUserId.textContent = profile.id;
  if (profile.avatar) avatarPreview.src = `/avatars/${profile.avatar}`;
  else avatarPreview.src = '';
  renderColorPalette(profile.color);
}

// ========== ЦВЕТОВАЯ ПАЛИТРА ==========
const defaultColors = ['#4dabf7','#ff6b6b','#63e6a0','#ffd43b','#cc5de8','#ff922b','#20c997','#e64980'];
let selectedColor = currentUser?.color || '#4dabf7';
function renderColorPalette(currentColor) {
  colorPalette.innerHTML = '';
  defaultColors.forEach(color => {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.style.backgroundColor = color;
    if (color === currentColor) swatch.classList.add('selected');
    swatch.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      selectedColor = color;
    });
    colorPalette.appendChild(swatch);
  });
  selectedColor = currentColor;
}

// ========== ВЕРХНИЕ КНОПКИ ==========
document.getElementById('btnCreateRoom').addEventListener('click', () => {
  document.getElementById('modalCreateRoom').classList.remove('hidden');
});
document.getElementById('btnFind').addEventListener('click', () => {
  document.getElementById('modalFind').classList.remove('hidden');
  renderRecentSearches();
});
document.getElementById('btnDownload').addEventListener('click', () => {
  downloadChatAsTxt();
});
document.getElementById('btnSettings').addEventListener('click', () => {
  document.getElementById('modalSettings').classList.remove('hidden');
});
document.getElementById('btnList').addEventListener('click', () => {
  document.getElementById('modalList').classList.remove('hidden');
  renderRoomsAndContacts();
});
document.getElementById('btnSend').addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

// Закрытие модалок
document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => {
    const modalId = btn.getAttribute('data-modal');
    if (modalId) document.getElementById(modalId).classList.add('hidden');
  });
});
window.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal')) e.target.classList.add('hidden');
});

// ========== СОЗДАНИЕ ЧАТА ==========
document.getElementById('btnCreateRoomSubmit').addEventListener('click', () => {
  const name = document.getElementById('inputRoomName').value.trim();
  if (!name) return alert('Введите название');
  socket.emit('createRoom', name);
  document.getElementById('modalCreateRoom').classList.add('hidden');
  document.getElementById('inputRoomName').value = '';
});
socket.on('roomCreated', ({ roomId, name }) => {
  joinRoom(roomId);
});

// ========== ПОИСК ==========
document.getElementById('btnFindSubmit').addEventListener('click', () => {
  const id = document.getElementById('inputFindId').value.trim();
  if (!id) return;
  addRecentSearch(id, '');
  if (id.startsWith('6')) {
    joinRoom(id);
  } else {
    socket.emit('startPrivateChat', id);
  }
  document.getElementById('modalFind').classList.add('hidden');
  document.getElementById('inputFindId').value = '';
});

function addRecentSearch(id, name) {
  const existing = recentSearches.find(s => s.id === id);
  if (existing) recentSearches = recentSearches.filter(s => s.id !== id);
  recentSearches.unshift({ id, name: name || id });
  if (recentSearches.length > 15) recentSearches.pop();
  localStorage.setItem('kfr_recentSearches', JSON.stringify(recentSearches));
}
function renderRecentSearches() {
  const list = document.getElementById('recentSearchesList');
  if (!list) return;
  list.innerHTML = '';
  recentSearches.forEach(s => {
    const li = document.createElement('li');
    li.textContent = `${s.name} (ID: ${s.id})`;
    li.addEventListener('click', () => {
      document.getElementById('inputFindId').value = s.id;
    });
    list.appendChild(li);
  });
}

// ========== НАСТРОЙКИ ==========
document.getElementById('btnSaveProfile').addEventListener('click', () => {
  const nick = inputNickname.value.trim();
  const description = inputDescription.value.trim();
  const theme = themeSelect.value;
  if (!nick) return alert('Никнейм обязателен');
  socket.emit('updateProfile', { nick, color: selectedColor, description, theme });
  document.getElementById('modalSettings').classList.add('hidden');
});

// Аватар
avatarFile.addEventListener('change', async () => {
  const file = avatarFile.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('avatar', file);
  formData.append('userId', currentUser.id);
  try {
    const res = await fetch('/upload/avatar', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.avatar) {
      currentUser.avatar = data.avatar;
      avatarPreview.src = `/avatars/${data.avatar}`;
    }
  } catch (e) { alert('Ошибка загрузки аватара'); }
});

// Фон
bgFile.addEventListener('change', async () => {
  const file = bgFile.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('background', file);
  formData.append('userId', currentUser.id);
  try {
    const res = await fetch('/upload/background', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.background) {
      currentUser.background = data.background;
      document.body.style.backgroundImage = `url(/backgrounds/${data.background})`;
    }
  } catch (e) { alert('Ошибка загрузки фона'); }
});

// Обновление профиля с сервера
socket.on('profileUpdated', (profile) => {
  if (currentUser && currentUser.id === profile.id) {
    currentUser = profile;
    applyUserSettings(profile);
  }
});

// ========== СПИСОК ЧАТОВ И ЮЗЕРОВ ==========
function renderRoomsAndContacts() {
  const roomsList = document.getElementById('roomsList');
  const contactsList = document.getElementById('contactsList');
  if (roomsList) {
    roomsList.innerHTML = '';
    if (currentUser?.subscribedRooms) {
      currentUser.subscribedRooms.forEach(roomId => {
        const li = document.createElement('li');
        li.textContent = `Чат [${roomId}]`;
        li.addEventListener('click', () => {
          joinRoom(roomId);
          document.getElementById('modalList').classList.add('hidden');
        });
        roomsList.appendChild(li);
      });
    }
  }
  if (contactsList) {
    contactsList.innerHTML = '';
    recentSearches.filter(s => !s.id.startsWith('6')).forEach(s => {
      const li = document.createElement('li');
      li.textContent = `${s.name} [${s.id}]`;
      li.addEventListener('click', () => {
        socket.emit('startPrivateChat', s.id);
        document.getElementById('modalList').classList.add('hidden');
      });
      contactsList.appendChild(li);
    });
  }
}

// ========== РАБОТА С КОМНАТАМИ ==========
function joinRoom(roomId) {
  if (currentRoomId) socket.emit('leaveRoom', currentRoomId);
  currentRoomId = roomId;
  socket.emit('joinRoom', roomId);
  messagesContainer.innerHTML = ''; // очищаем пока
  chatHeader.textContent = 'Загрузка...';
}

socket.on('roomInfo', (info) => {
  currentMessages = info.messages;
  roomParticipants = info.participants;
  chatHeader.textContent = `${info.name} [${info.roomId}]`;
  renderMessages();
  renderParticipants();
  renderSubscriptionButton(info.roomId);
});

socket.on('userJoined', (user) => {
  if (!roomParticipants.find(p => p.id === user.id)) {
    roomParticipants.push({...user, online: true});
    renderParticipants();
  }
});

socket.on('userLeft', (userId) => {
  roomParticipants = roomParticipants.filter(p => p.id !== userId);
  renderParticipants();
});

// ========== СООБЩЕНИЯ ==========
socket.on('newMessage', (msg) => {
  currentMessages.push(msg);
  appendMessage(msg);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  playSound('message');
});

function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !currentRoomId) return;
  socket.emit('chatMessage', { roomId: currentRoomId, text });
  messageInput.value = '';
}

function renderMessages() {
  messagesContainer.innerHTML = '';
  currentMessages.forEach(msg => appendMessage(msg));
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function appendMessage(msg) {
  const div = document.createElement('div');
  div.className = 'message' + (msg.user === 'System' ? ' system' : '');
  let html = '';
  if (msg.time) html += `<span class="time">[${msg.time}]</span>`;
  if (msg.user) {
    html += `<span class="user" style="color:${msg.color || 'var(--accent)'}" data-user-id="${msg.userId || ''}">${msg.user}:</span>`;
  }
  html += `<span class="text">${escapeHtml(msg.text)}</span>`;
  div.innerHTML = html;
  const userSpan = div.querySelector('.user');
  if (userSpan && msg.userId) {
    userSpan.addEventListener('click', () => {
      showProfile(msg.userId);
    });
  }
  messagesContainer.appendChild(div);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ========== УЧАСТНИКИ ==========
function renderParticipants() {
  participantsList.innerHTML = '';
  roomParticipants.forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="participant-info">
        <span class="online-dot ${p.online ? '' : 'offline-dot'}"></span>
        <span style="color:${p.color}">${p.nick}</span>
        <span style="color:#888; font-size:0.8rem;">[${p.id}]</span>
      </div>
      <button class="btn-action" data-action="${getActionForUser(p.id)}" data-target="${p.id}">${getActionTextForUser(p.id)}</button>
    `;
    const btn = li.querySelector('button');
    if (btn && btn.dataset.action !== 'none') {
      btn.addEventListener('click', () => handleParticipantAction(btn.dataset.target, btn.dataset.action));
    }
    participantsList.appendChild(li);
  });
}

function getActionForUser(userId) {
  if (currentRoomId === 'general') return 'none';
  if (currentRoomId.startsWith('private_')) {
    return userId === currentUser.id ? 'none' : 'private';
  }
  return 'none';
}
function getActionTextForUser(userId) {
  if (currentRoomId.startsWith('private_') && userId !== currentUser.id) {
    return currentUser.blockedUsers?.includes(userId) ? 'Разблокировать' : 'Заблокировать';
  }
  return '';
}
function handleParticipantAction(targetId, action) {
  if (action === 'private') {
    if (currentUser.blockedUsers?.includes(targetId)) {
      socket.emit('unblockUser', targetId);
    } else {
      socket.emit('blockUser', targetId);
    }
  }
}

// ========== КНОПКИ ПОДПИСКИ ==========
function renderSubscriptionButton(roomId) {
  subBtnContainer.innerHTML = '';
  if (roomId === 'general' || roomId.startsWith('private_')) return;
  const isSub = currentUser.subscribedRooms?.includes(roomId);
  const btn = document.createElement('button');
  btn.className = 'btn-action';
  btn.textContent = isSub ? 'Отписаться' : 'Подписаться';
  btn.addEventListener('click', () => {
    if (isSub) {
      socket.emit('unsubscribeRoom', roomId);
      playSound('unsubscribe');
    } else {
      socket.emit('subscribeRoom', roomId);
      playSound('subscribe');
    }
  });
  subBtnContainer.appendChild(btn);
}

// ========== БЛОКИРОВКА ==========
socket.on('userBlocked', (targetId) => {
  if (!currentUser.blockedUsers) currentUser.blockedUsers = [];
  if (!currentUser.blockedUsers.includes(targetId)) currentUser.blockedUsers.push(targetId);
  renderParticipants();
});
socket.on('userUnblocked', (targetId) => {
  currentUser.blockedUsers = currentUser.blockedUsers.filter(id => id !== targetId);
  renderParticipants();
});

// ========== ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ ==========
function showProfile(userId) {
  socket.emit('getUserProfile', userId);
}
socket.on('userProfile', (profile) => {
  const modal = document.getElementById('modalProfile');
  const content = document.getElementById('profileContent');
  content.innerHTML = `
    <img src="${profile.avatar ? '/avatars/' + profile.avatar : 'https://via.placeholder.com/100'}" alt="Аватар">
    <div class="nick" style="color:${profile.color}">${profile.nick}</div>
    <div class="last-seen">Последний раз в сети: ${new Date(profile.lastSeen).toLocaleString()}</div>
    <div class="description">${profile.description || ''}</div>
  `;
  modal.classList.remove('hidden');
});

// ========== СКАЧИВАНИЕ TXT ==========
function downloadChatAsTxt() {
  if (!currentMessages.length) return alert('История пуста');
  let content = `Чат: ${chatHeader.textContent}\n`;
  currentMessages.forEach(msg => {
    content += `[${msg.time || ''}] ${msg.user}: ${msg.text}\n`;
  });
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `чат_${currentRoomId}.txt`;
  a.click();
}

// ========== ЗВУКИ ==========
const soundFiles = {
  message: new Audio('/sounds/message.mp3'),
  subscribe: new Audio('/sounds/subscribe.mp3'),
  unsubscribe: new Audio('/sounds/unsubscribe.mp3')
};
function playSound(type) {
  if (soundFiles[type]) {
    soundFiles[type].currentTime = 0;
    soundFiles[type].play().catch(() => {});
  }
}

// ========== УВЕДОМЛЕНИЯ ==========
if (Notification.permission === 'default') Notification.requestPermission();
function showNotification(text) {
  if (Notification.permission === 'granted') {
    new Notification('К.ФриРунет', { body: text, icon: '/icons/icon-192.png' });
  }
}

// ========== ДОП. ОБРАБОТЧИКИ ==========
socket.on('roomNameChanged', (newName) => {
  chatHeader.textContent = `${newName} [${currentRoomId}]`;
});
socket.on('systemMessage', (data) => {
  if (data.roomId === currentRoomId) {
    const sysMsg = { time: '', user: 'System', text: data.text, color: '#ffaa00' };
    appendMessage(sysMsg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
});
socket.on('subscribed', (roomId) => {
  if (roomId === currentRoomId) renderSubscriptionButton(roomId);
});
socket.on('unsubscribed', (roomId) => {
  if (roomId === currentRoomId) renderSubscriptionButton(roomId);
});
