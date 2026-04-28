// client.js — Криста 3.0 (Мессенджер) — полный клиентский скрипт

const socket = io();

// ================== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ==================
let currentUser = null;
let currentRoomId = 'general';
let currentMessages = [];
let roomParticipants = [];
let recentSearches = JSON.parse(localStorage.getItem('kfr_recentSearches') || '[]');
let typingTimeout = null;
let activeContextMessageId = null;
let activeReactionMessageId = null;
let searchResults = [];
let searchIndex = -1;

// Звуки
const soundFiles = {
  message: new Audio('/sounds/message.mp3'),
  subscribe: new Audio('/sounds/subscribe.mp3'),
  unsubscribe: new Audio('/sounds/unsubscribe.mp3')
};

// ================== DOM-ЭЛЕМЕНТЫ ==================
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
const chatTitle = document.getElementById('chatTitle');
const chatIdDisplay = document.getElementById('chatIdDisplay');
const messageInput = document.getElementById('messageInput');
const participantsList = document.getElementById('participantsList');
const subBtnContainer = document.getElementById('subBtnContainer');
const typingIndicator = document.getElementById('typingIndicator');
const emojiPicker = document.getElementById('emojiPicker');
const contextMenu = document.getElementById('contextMenu');
const reactionPicker = document.getElementById('reactionPicker');
const searchBar = document.getElementById('searchBar');
const searchInput = document.getElementById('searchInput');

const displayUserId = document.getElementById('displayUserId');
const inputNickname = document.getElementById('inputNickname');
const inputDescription = document.getElementById('inputDescription');
const colorPalette = document.getElementById('colorPalette');
const avatarFile = document.getElementById('avatarFile');
const avatarPreview = document.getElementById('avatarPreview');
const bgFile = document.getElementById('bgFile');
const themeSelect = document.getElementById('themeSelect');

let authMode = 'login';

// ================== АВТОРИЗАЦИЯ ==================
// Пытаемся восстановить сессию из localStorage
const savedSession = JSON.parse(localStorage.getItem('kfr_session') || 'null');
if (savedSession && savedSession.login && savedSession.password) {
  // Автоматически входим при загрузке
  socket.emit('login', { login: savedSession.login, password: savedSession.password });
} else {
  authOverlay.classList.remove('hidden');
}

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
  // Сохраняем сессию в localStorage
  localStorage.setItem('kfr_session', JSON.stringify({
    login: authLogin.value.trim(),
    password: authPassword.value
  }));
  authOverlay.classList.add('hidden');
  mainApp.classList.remove('hidden');
  applyUserSettings(profile);
  joinRoom('general');
});

function applyUserSettings(profile) {
  document.body.className = profile.theme === 'light' ? 'light' : '';
  themeSelect.value = profile.theme;
  if (profile.background) {
    document.body.style.backgroundImage = `url(/backgrounds/${profile.background})`;
    document.body.style.backgroundSize = 'cover';
  }
  inputNickname.value = profile.nick;
  inputDescription.value = profile.description || '';
  displayUserId.textContent = profile.id;
  if (profile.avatar) avatarPreview.src = `/avatars/${profile.avatar}`;
  else avatarPreview.src = '';
  renderColorPalette(profile.color);
}

// ================== ВЕРХНИЕ КНОПКИ ==================
document.getElementById('btnCreateRoom').addEventListener('click', () => {
  document.getElementById('modalCreateRoom').classList.remove('hidden');
});
document.getElementById('btnFind').addEventListener('click', () => {
  document.getElementById('modalFind').classList.remove('hidden');
  renderRecentSearches();
});
document.getElementById('btnDownload').addEventListener('click', downloadChatAsTxt);
document.getElementById('btnSettings').addEventListener('click', () => {
  document.getElementById('modalSettings').classList.remove('hidden');
});
document.getElementById('btnList').addEventListener('click', () => {
  document.getElementById('modalList').classList.remove('hidden');
  renderRoomsAndContacts();
});

// Отправка сообщения
document.getElementById('btnSend').addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage();
});
messageInput.addEventListener('input', () => {
  socket.emit('typing', currentRoomId);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('stopTyping', currentRoomId);
  }, 2000);
});

// Эмодзи
document.getElementById('emojiBtn').addEventListener('click', () => {
  emojiPicker.classList.toggle('hidden');
  if (!emojiPicker.classList.contains('hidden')) buildEmojiPicker();
});

// Поиск в чате
document.getElementById('closeSearch').addEventListener('click', () => {
  searchBar.classList.add('hidden');
});
document.getElementById('searchPrev').addEventListener('click', () => {
  navigateSearch(-1);
});
document.getElementById('searchNext').addEventListener('click', () => {
  navigateSearch(1);
});
searchInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    performSearch(searchInput.value);
  }
});

// Модалки: закрытие
document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const modalId = btn.dataset.modal;
    if (modalId) document.getElementById(modalId).classList.add('hidden');
  });
});
window.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal')) e.target.classList.add('hidden');
});

// Создание комнаты
document.getElementById('btnCreateRoomSubmit').addEventListener('click', () => {
  const name = document.getElementById('inputRoomName').value.trim();
  if (!name) return alert('Введите название');
  socket.emit('createRoom', name);
  document.getElementById('modalCreateRoom').classList.add('hidden');
  document.getElementById('inputRoomName').value = '';
});

// Поиск по ID
document.getElementById('btnFindSubmit').addEventListener('click', () => {
  const id = document.getElementById('inputFindId').value.trim();
  if (!id) return;
  addRecentSearch(id, id);
  if (id.startsWith('6')) {
    joinRoom(id);
  } else {
    socket.emit('startPrivateChat', id);
  }
  document.getElementById('modalFind').classList.add('hidden');
  document.getElementById('inputFindId').value = '';
});

// Сохранение профиля
document.getElementById('btnSaveProfile').addEventListener('click', () => {
  const nick = inputNickname.value.trim();
  const description = inputDescription.value.trim();
  const theme = themeSelect.value;
  if (!nick) return alert('Никнейм обязателен');
  socket.emit('updateProfile', { nick, color: selectedColor, description, theme });
  document.getElementById('modalSettings').classList.add('hidden');
});

// Загрузка аватара
avatarFile.addEventListener('change', async () => {
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
});

// Загрузка фона
bgFile.addEventListener('change', async () => {
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
});

// Цветовая палитра
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

// ================== РАБОТА С КОМНАТАМИ ==================
function joinRoom(roomId) {
  if (currentRoomId) socket.emit('leaveRoom', currentRoomId);
  currentRoomId = roomId;
  socket.emit('joinRoom', roomId);
}

socket.on('roomInfo', (info) => {
  currentMessages = info.messages;
  roomParticipants = info.participants;
  chatTitle.textContent = info.name;
  chatIdDisplay.textContent = `[${info.roomId}]`;
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

socket.on('typing', (data) => {
  if (data.roomId === currentRoomId && data.userId !== currentUser.id) {
    typingIndicator.textContent = `${data.nick} печатает...`;
    typingIndicator.classList.remove('hidden');
  }
});
socket.on('stopTyping', (data) => {
  if (data.roomId === currentRoomId) {
    typingIndicator.classList.add('hidden');
  }
});

// ================== СООБЩЕНИЯ ==================
socket.on('newMessage', (msg) => {
  currentMessages.push(msg);
  appendMessage(msg);
  scrollToBottom();
  if (document.hidden && msg.userId !== currentUser.id) {
    playSound('message');
    showNotification(`Новое сообщение от ${msg.user}`);
  }
});

socket.on('messageEdited', (data) => {
  const idx = currentMessages.findIndex(m => m._id === data._id);
  if (idx !== -1) {
    currentMessages[idx] = data;
    renderMessages();
  }
});

socket.on('messageDeleted', (data) => {
  currentMessages = currentMessages.filter(m => m._id !== data._id);
  renderMessages();
});

socket.on('reactionUpdate', (data) => {
  const msg = currentMessages.find(m => m._id === data._id);
  if (msg) {
    msg.reactions = data.reactions;
    renderMessageReactions(msg);
  }
});

// ================== ОТРИСОВКА ==================
function renderMessages() {
  messagesContainer.innerHTML = '';
  currentMessages.forEach(appendMessage);
  scrollToBottom();
}

function appendMessage(msg) {
  const div = document.createElement('div');
  div.className = 'message';
  div.dataset.id = msg._id;
  
  // Собираем содержимое
  let html = '';
  if (msg.replyTo) {
    const repliedMsg = currentMessages.find(m => m._id === msg.replyTo);
    if (repliedMsg) {
      html += `<div class="reply-preview">↪ ${repliedMsg.user}: ${repliedMsg.text.substring(0, 50)}</div>`;
    }
  }
  html += `<div class="msg-header">`;
  html += `<span class="user" style="color:${msg.color || 'var(--accent)'}" data-user-id="${msg.userId || ''}">${msg.user}</span>`;
  html += `<span class="time">${msg.time || ''}</span>`;
  if (msg.edited) html += `<span class="edited">(изм.)</span>`;
  html += `</div><div class="text">${msg.text}</div>`;
  
  if (msg.reactions && msg.reactions.length) {
    html += `<div class="reactions">${msg.reactions.map(r => `<span class="reaction-badge" data-emoji="${r.emoji}">${r.emoji} ${r.count || 1}</span>`).join('')}</div>`;
  }
  
  div.innerHTML = html;
  
  // Обработчик клика по нику
  const userSpan = div.querySelector('.user');
  if (userSpan && msg.userId) {
    userSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      socket.emit('getUserProfile', msg.userId);
    });
  }
  
  // Обработчик контекстного меню (правая кнопка или долгое нажатие)
  div.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, msg._id);
  });
  div.addEventListener('click', () => {
    hideContextMenus();
  });
  
  // Реакции
  const reactionDivs = div.querySelectorAll('.reaction-badge');
  reactionDivs.forEach(badge => {
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      const emoji = badge.dataset.emoji;
      socket.emit('toggleReaction', { roomId: currentRoomId, messageId: msg._id, emoji });
    });
  });
  
  messagesContainer.appendChild(div);
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// ================== КОНТЕКСТНОЕ МЕНЮ ==================
function showContextMenu(x, y, messageId) {
  hideContextMenus();
  activeContextMessageId = messageId;
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.classList.remove('hidden');
  
  // Привязываем действия
  contextMenu.querySelector('[data-action="reply"]').onclick = () => {
    socket.emit('replyMessage', { roomId: currentRoomId, messageId });
    hideContextMenus();
  };
  contextMenu.querySelector('[data-action="edit"]').onclick = () => {
    const msg = currentMessages.find(m => m._id === messageId);
    if (msg && msg.userId === currentUser.id) {
      const newText = prompt('Редактировать сообщение:', msg.text);
      if (newText && newText.trim()) {
        socket.emit('editMessage', { roomId: currentRoomId, messageId, text: newText.trim() });
      }
    } else {
      alert('Редактировать можно только свои сообщения');
    }
    hideContextMenus();
  };
  contextMenu.querySelector('[data-action="delete"]').onclick = () => {
    const msg = currentMessages.find(m => m._id === messageId);
    if (msg && msg.userId === currentUser.id) {
      socket.emit('deleteMessage', { roomId: currentRoomId, messageId });
    } else {
      alert('Удалять можно только свои сообщения');
    }
    hideContextMenus();
  };
  contextMenu.querySelector('[data-action="react"]').onclick = () => {
    activeReactionMessageId = messageId;
    reactionPicker.style.left = x + 'px';
    reactionPicker.style.top = (y + 40) + 'px';
    reactionPicker.classList.remove('hidden');
    hideContextMenus();
  };
  contextMenu.querySelector('[data-action="copy"]').onclick = () => {
    const msg = currentMessages.find(m => m._id === messageId);
    if (msg) {
      navigator.clipboard.writeText(msg.text);
    }
    hideContextMenus();
  };
}

function hideContextMenus() {
  contextMenu.classList.add('hidden');
  reactionPicker.classList.add('hidden');
  activeContextMessageId = null;
  activeReactionMessageId = null;
}

document.addEventListener('click', (e) => {
  if (!contextMenu.contains(e.target) && !reactionPicker.contains(e.target)) {
    hideContextMenus();
  }
});

// Реакции
reactionPicker.querySelectorAll('.reaction-emoji').forEach(emoji => {
  emoji.addEventListener('click', () => {
    if (activeReactionMessageId) {
      socket.emit('toggleReaction', { roomId: currentRoomId, messageId: activeReactionMessageId, emoji: emoji.textContent });
      hideContextMenus();
    }
  });
});

// ================== ЭМОДЗИ ПАНЕЛЬ ==================
function buildEmojiPicker() {
  const emojis = ['😀','😂','😍','😢','😡','👍','❤️','🔥','🎉','😎','🤔','😴','🥳','🙏','💪','🌸'];
  emojiPicker.innerHTML = '';
  emojis.forEach(emoji => {
    const span = document.createElement('span');
    span.textContent = emoji;
    span.addEventListener('click', () => {
      messageInput.value += emoji;
      emojiPicker.classList.add('hidden');
    });
    emojiPicker.appendChild(span);
  });
}

// ================== ПОИСК В ЧАТЕ ==================
function performSearch(query) {
  if (!query) return;
  searchResults = [];
  currentMessages.forEach((msg, index) => {
    if (msg.text.toLowerCase().includes(query.toLowerCase())) {
      searchResults.push(index);
    }
  });
  searchIndex = 0;
  if (searchResults.length > 0) {
    highlightSearchResult(searchResults[0]);
  } else {
    alert('Ничего не найдено');
  }
}

function navigateSearch(direction) {
  if (searchResults.length === 0) return;
  searchIndex += direction;
  if (searchIndex < 0) searchIndex = searchResults.length - 1;
  if (searchIndex >= searchResults.length) searchIndex = 0;
  highlightSearchResult(searchResults[searchIndex]);
}

function highlightSearchResult(index) {
  const msg = currentMessages[index];
  if (msg) {
    const msgDiv = messagesContainer.querySelector(`.message[data-id="${msg._id}"]`);
    if (msgDiv) {
      msgDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
      msgDiv.style.background = 'rgba(108, 140, 255, 0.2)';
      setTimeout(() => { msgDiv.style.background = ''; }, 2000);
    }
  }
}

// ================== СКАЧАТЬ TXT (UTF-8 BOM) ==================
function downloadChatAsTxt() {
  if (!currentMessages.length) return alert('История пуста');
  const BOM = '\uFEFF';
  let content = BOM + `Чат: ${chatTitle.textContent} ${chatIdDisplay.textContent}\n`;
  currentMessages.forEach(msg => {
    let line = `[${msg.time}] ${msg.user}: ${msg.text}`;
    if (msg.edited) line += ' (изменено)';
    content += line + '\n';
  });
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `чат_${currentRoomId}.txt`;
  a.click();
}

// ================== УВЕДОМЛЕНИЯ И ЗВУКИ ==================
function playSound(type) {
  if (soundFiles[type]) {
    soundFiles[type].currentTime = 0;
    soundFiles[type].play().catch(() => {});
  }
}

function showNotification(text) {
  if (Notification.permission === 'granted') {
    new Notification('Криста 3.0', { body: text, icon: '/icons/icon-192.png' });
  } else if (Notification.permission === 'default') {
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') showNotification(text);
    });
  }
}

// ================== ОСТАЛЬНЫЕ ФУНКЦИИ ==================
function renderParticipants() {
  // ... (аналогично предыдущей версии, но с добавлением статуса онлайн)
}

function renderSubscriptionButton(roomId) {
  // ... (подписка/отписка)
}

function addRecentSearch(id, name) {
  // ... (сохранение в localStorage и обновление списка)
}

function renderRecentSearches() {
  // ... (отображение последних 15 поисков)
}

function renderRoomsAndContacts() {
  // ... (список подписок и контактов)
}

function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !currentRoomId) return;
  socket.emit('chatMessage', { roomId: currentRoomId, text });
  messageInput.value = '';
  socket.emit('stopTyping', currentRoomId);
}

// Вспомогательные обработчики
socket.on('userProfile', (profile) => {
  document.getElementById('profileContent').innerHTML = `
    <img src="${profile.avatar ? '/avatars/' + profile.avatar : 'https://via.placeholder.com/90'}" alt="Аватар">
    <div class="nick" style="color:${profile.color}">${profile.nick}</div>
    <div class="last-seen">Последний вход: ${new Date(profile.lastSeen).toLocaleString()}</div>
    <div class="description">${profile.description || ''}</div>
  `;
  document.getElementById('modalProfile').classList.remove('hidden');
});

socket.on('roomCreated', ({ roomId, name }) => {
  joinRoom(roomId);
});

// Инициализация при загрузке
window.addEventListener('load', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }
  if (Notification.permission === 'default') Notification.requestPermission();
});
