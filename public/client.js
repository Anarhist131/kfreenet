if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('Service Worker зарегистрирован:', registration.scope);
      })
      .catch(error => {
        console.log('Ошибка регистрации Service Worker:', error);
      });
  });
}
// client.js — К.ФриРунет 2.0 (звуки, темы, профили, уведомления)

const socket = io();
let currentUser = null;
let currentRoomId = 'general';
let currentMessages = [];
let roomParticipants = [];
let recentSearches = JSON.parse(localStorage.getItem('kfr_recentSearches') || '[]');

// ========== ЗВУКИ ==========
const soundFiles = {
  message: new Audio('/sounds/message.mp3'),
  subscribe: new Audio('/sounds/subscribe.mp3'),
  unsubscribe: new Audio('/sounds/unsubscribe.mp3')
};

// ========== DOM-элементы ==========
const authOverlay = document.getElementById('authOverlay');
const mainApp = document.getElementById('mainApp');
const authForm = document.getElementById('authForm');
const authLogin = document.getElementById('authLogin');
const authPassword = document.getElementById('authPassword');
const authNick = document.getElementById('authNick');
const registerNickField = document.getElementById('registerNickField');
const authSubmit = document.getElementById('authSubmit');
const authError = document.getElementById('authError');
const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');

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

let authMode = 'login'; // login | register

// ========== ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК АВТОРИЗАЦИИ ==========
tabLogin.addEventListener('click', () => {
  authMode = 'login';
  tabLogin.classList.add('active');
  tabRegister.classList.remove('active');
  registerNickField.classList.add('hidden');
  authSubmit.textContent = 'Войти';
});
tabRegister.addEventListener('click', () => {
  authMode = 'register';
  tabRegister.classList.add('active');
  tabLogin.classList.remove('active');
  registerNickField.classList.remove('hidden');
  authSubmit.textContent = 'Зарегистрироваться';
});

// ========== АВТОРИЗАЦИЯ / РЕГИСТРАЦИЯ ==========
authForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const login = authLogin.value.trim();
  const password = authPassword.value;
  const nick = authNick.value.trim();
  authError.textContent = '';

  if (authMode === 'register') {
    socket.emit('register', { login, password, nick });
  } else {
    socket.emit('login', { login, password });
  }
});

socket.on('authError', (msg) => {
  authError.textContent = msg;
});

socket.on('authSuccess', (profile) => {
  currentUser = profile;
  authOverlay.classList.add('hidden');
  mainApp.classList.remove('hidden');
  applyUserSettings(profile);
  joinRoom('general');
});

// ========== ПРИМЕНЕНИЕ НАСТРОЕК ПОЛЬЗОВАТЕЛЯ ==========
function applyUserSettings(profile) {
  // Тема
  document.body.className = profile.theme === 'light' ? 'light' : '';
  themeSelect.value = profile.theme;

  // Обои (если есть)
  if (profile.background) {
    document.body.style.backgroundImage = `url(/backgrounds/${profile.background})`;
    document.body.style.backgroundSize = 'cover';
  } else {
    document.body.style.backgroundImage = '';
  }

  // Ник в настройках
  inputNickname.value = profile.nick;
  inputDescription.value = profile.description || '';
  displayUserId.textContent = profile.id;
  if (profile.avatar) avatarPreview.src = `/avatars/${profile.avatar}`;
  else avatarPreview.src = '';

  // Палитра цветов
  renderColorPalette(profile.color);
}

// ========== КНОПКИ ДЕЙСТВИЙ (аналогично первой версии) ==========
document.getElementById('btnCreateRoom').onclick = () => document.getElementById('modalCreateRoom').classList.remove('hidden');
document.getElementById('btnFind').onclick = () => {
  document.getElementById('modalFind').classList.remove('hidden');
  renderRecentSearches();
};
document.getElementById('btnDownload').onclick = downloadChatAsTxt;
document.getElementById('btnSettings').onclick = () => document.getElementById('modalSettings').classList.remove('hidden');
document.getElementById('btnList').onclick = () => {
  document.getElementById('modalList').classList.remove('hidden');
  renderRoomsAndContacts();
};
document.getElementById('btnSend').onclick = sendMessage;
messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

// Закрытие модалок
document.querySelectorAll('.modal-close').forEach(btn => {
  btn.onclick = () => {
    const modalId = btn.dataset.modal;
    if (modalId) document.getElementById(modalId).classList.add('hidden');
  };
});
window.onclick = (e) => { if (e.target.classList.contains('modal')) e.target.classList.add('hidden'); };

// ========== НАСТРОЙКИ ==========
const defaultColors = ['#4dabf7','#ff6b6b','#63e6a0','#ffd43b','#cc5de8','#ff922b','#20c997','#e64980'];
let selectedColor = currentUser?.color || '#4dabf7';

function renderColorPalette(currentColor) {
  colorPalette.innerHTML = '';
  defaultColors.forEach(color => {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.style.backgroundColor = color;
    if (color === currentColor) swatch.classList.add('selected');
    swatch.onclick = () => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      selectedColor = color;
    };
    colorPalette.appendChild(swatch);
  });
  selectedColor = currentColor;
}

// Загрузка аватара
avatarFile.onchange = async () => {
  const file = avatarFile.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('avatar', file);
  formData.append('userId', currentUser.id);
  const res = await fetch('/upload/avatar', { method: 'POST', body: formData });
  const data = await res.json();
  if (data.avatar) {
    currentUser.avatar = data.avatar;
    avatarPreview.src = `/avatars/${data.avatar}`;
  }
};

// Загрузка обоев
bgFile.onchange = async () => {
  const file = bgFile.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('background', file);
  formData.append('userId', currentUser.id);
  const res = await fetch('/upload/background', { method: 'POST', body: formData });
  const data = await res.json();
  if (data.background) {
    currentUser.background = data.background;
    document.body.style.backgroundImage = `url(/backgrounds/${data.background})`;
    document.body.style.backgroundSize = 'cover';
  }
};

document.getElementById('btnSaveProfile').onclick = () => {
  const nick = inputNickname.value.trim();
  const description = inputDescription.value.trim();
  const theme = themeSelect.value;
  if (!nick) return alert('Никнейм обязателен');
  socket.emit('updateProfile', { nick, color: selectedColor, description, theme });
  document.getElementById('modalSettings').classList.add('hidden');
};

// ========== РАБОТА С КОМНАТАМИ ==========
function joinRoom(roomId) {
  if (currentRoomId) socket.emit('leaveRoom', currentRoomId);
  currentRoomId = roomId;
  socket.emit('joinRoom', roomId);
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

socket.on('newMessage', (msg) => {
  currentMessages.push(msg);
  appendMessage(msg);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  // Звук + уведомление, если окно не в фокусе
  if (document.hidden && msg.user !== 'System') {
    playSound('message');
    showNotification(`Новое сообщение от ${msg.user}`);
  } else if (!document.hidden && msg.user !== 'System') {
    playSound('message');
  }
});

socket.on('roomNameChanged', (newName) => {
  chatHeader.textContent = `${newName} [${currentRoomId}]`;
});

// ========== ОТРИСОВКА ==========
function renderMessages() {
  messagesContainer.innerHTML = '';
  currentMessages.forEach(appendMessage);
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
  html += `<span class="text">${msg.text}</span>`;
  div.innerHTML = html;
  // Клик по нику открывает профиль
  const userSpan = div.querySelector('.user');
  if (userSpan && msg.userId) {
    userSpan.onclick = () => showProfile(msg.userId);
  }
  messagesContainer.appendChild(div);
}

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
    li.querySelector('button')?.addEventListener('click', (e) => {
      const targetId = e.target.dataset.target;
      const action = e.target.dataset.action;
      handleParticipantAction(targetId, action);
    });
    participantsList.appendChild(li);
  });
}

function getActionForUser(userId) {
  if (currentRoomId === 'general') return 'none';
  if (currentRoomId.startsWith('private_')) {
    if (userId === currentUser.id) return 'none';
    return 'private';
  }
  return 'none';
}
function getActionTextForUser(userId) {
  if (currentRoomId.startsWith('private_')) {
    if (currentUser.blockedUsers.includes(userId)) return 'Разблокировать';
    return 'Заблокировать';
  }
  return '';
}
function handleParticipantAction(targetId, action) {
  if (action === 'private') {
    if (currentUser.blockedUsers.includes(targetId)) {
      socket.emit('unblockUser', targetId);
    } else {
      socket.emit('blockUser', targetId);
    }
  }
}

// ========== ПОДПИСКА НА КОМНАТУ ==========
function renderSubscriptionButton(roomId) {
  subBtnContainer.innerHTML = '';
  if (roomId === 'general' || roomId.startsWith('private_')) return;
  const isSub = currentUser.subscribedRooms?.includes(roomId);
  const btn = document.createElement('button');
  btn.className = 'btn-action';
  btn.textContent = isSub ? 'Отписаться' : 'Подписаться';
  btn.onclick = () => {
    if (isSub) {
      socket.emit('unsubscribeRoom', roomId);
      playSound('unsubscribe');
    } else {
      socket.emit('subscribeRoom', roomId);
      playSound('subscribe');
    }
  };
  subBtnContainer.appendChild(btn);
}

// ========== ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ ==========
async function showProfile(userId) {
  // Запросим свежие данные у сервера? У нас profiles хранится на сервере, но мы можем показать то, что знаем
  // Для простоты достанем из participants (если есть) или запросим событие.
  // Сделаем запрос через сокет:
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

// В server.js нужно добавить обработчик 'getUserProfile'
// (добавим ниже)

// ========== ОТПРАВКА СООБЩЕНИЙ ==========
function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !currentRoomId) return;
  socket.emit('chatMessage', { roomId: currentRoomId, text });
  messageInput.value = '';
}

// ========== СОЗДАНИЕ ЧАТА, ПОИСК И Т.Д. (используем те же модалки, что и раньше) ==========
// (Код модалок остаётся, просто ссылки на них должны быть в HTML)
// Добавьте их в index.html из предыдущего ответа.

// ========== СКАЧАТЬ TXT ==========
function downloadChatAsTxt() {
  if (!currentMessages.length) return alert('История пуста');
  let content = `Чат: ${chatHeader.textContent}\n`;
  currentMessages.forEach(msg => {
    content += `[${msg.time}] ${msg.user}: ${msg.text}\n`;
  });
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `чат_${currentRoomId}.txt`;
  a.click();
}

// ========== ЗВУКИ ==========
function playSound(type) {
  if (soundFiles[type]) {
    soundFiles[type].currentTime = 0;
    soundFiles[type].play().catch(() => {});
  }
}

// ========== УВЕДОМЛЕНИЯ ==========
function showNotification(text) {
  if (Notification.permission === 'granted') {
    new Notification('К.ФриРунет', { body: text, icon: '/favicon.ico' });
  } else if (Notification.permission === 'default') {
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') showNotification(text);
    });
  }
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (renderRecentSearches, renderRoomsAndContacts...) ==========
// Вставьте соответствующие функции из предыдущей версии, изменив только работу с currentUser.

// Не забудьте добавить в server.js обработчик 'getUserProfile':
// в socket-события:
socket.on('getUserProfile', (userId) => {
  const profile = profiles[userId];
  if (profile) socket.emit('userProfile', {
    nick: profile.nick,
    color: profile.color,
    avatar: profile.avatar,
    lastSeen: profile.lastSeen,
    description: profile.description
  });
});