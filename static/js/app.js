// ===== State =====
let token = localStorage.getItem('token') || '';
let currentUser = JSON.parse(localStorage.getItem('user') || 'null');
let categories = [];
let currentCategory = null; // null = all categories
let currentPage = 1;
let totalPages = 1;
let debounceTimer = null;
let showingExpiring = false; // 是否正在查看即将过期物品
let expiringItems = []; // 缓存即将过期物品
let expiringDays = 30; // 默认30天
let viewMode = 'grid'; // 'grid' 或 'list'

// ===== API Helper =====
async function api(method, path, data = null, isFormData = false) {
    const opts = {
        method,
        headers: {}
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (data && !isFormData) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(data);
    }
    if (data && isFormData) {
        opts.body = data;
    }
    try {
        const res = await fetch('/api' + path, opts);
        const json = await res.json();
        if (res.status === 401) {
            token = '';
            currentUser = null;
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            showAuthPage();
            showToast('登录已过期，请重新登录', 'error');
            return null;
        }
        if (!res.ok) {
            showToast(json.error || '操作失败', 'error');
            return null;
        }
        return json;
    } catch (e) {
        showToast('网络错误: ' + e.message, 'error');
        return null;
    }
}

// ===== Toast =====
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ===== Page Navigation =====
function showAuthPage() {
    document.getElementById('auth-page').classList.remove('hidden');
    document.getElementById('main-page').classList.add('hidden');
}

function showMainPage() {
    document.getElementById('auth-page').classList.add('hidden');
    document.getElementById('main-page').classList.remove('hidden');
    updateUserInfo();
    loadCategories();
    loadItems();
    loadExpiryAlerts();
}

function updateUserInfo() {
    const info = document.getElementById('user-info');
    if (currentUser) {
        let text = currentUser.username;
        if (currentUser.is_group) text += ' (组账号)';
        info.textContent = text;
    }
}

// ===== Auth Tab =====
function switchAuthTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if (tab === 'login') {
        document.getElementById('login-form').classList.remove('hidden');
        document.getElementById('register-form').classList.add('hidden');
        document.querySelectorAll('.tab-btn')[0].classList.add('active');
    } else {
        document.getElementById('login-form').classList.add('hidden');
        document.getElementById('register-form').classList.remove('hidden');
        document.querySelectorAll('.tab-btn')[1].classList.add('active');
    }
}

// ===== Auth Handlers =====
async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const res = await api('POST', '/auth/login', { username, password });
    if (res) {
        token = res.token;
        currentUser = res.user;
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(currentUser));
        showToast('登录成功', 'success');
        showMainPage();
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById('reg-username').value;
    const password = document.getElementById('reg-password').value;
    const isGroup = document.querySelector('input[name="reg-type"]:checked').value === 'group';
    const res = await api('POST', '/auth/register', { username, password, is_group: isGroup });
    if (res) {
        token = res.token;
        currentUser = res.user;
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(currentUser));
        showToast('注册成功', 'success');
        showMainPage();
    }
}

async function handleLogout() {
    await api('POST', '/auth/logout');
    token = '';
    currentUser = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    showAuthPage();
    showToast('已退出登录', 'info');
}

// ===== Modal =====
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// ===== Categories =====
async function loadCategories() {
    const res = await api('GET', '/categories');
    if (res) {
        categories = res.categories || [];
        renderCategories();
        updateCategorySelect();
    }
}

function renderCategories() {
    const list = document.getElementById('category-list');
    let html = '<div class="category-item' + (currentCategory === null ? ' active' : '') + '" onclick="selectCategory(null)">';
    html += '<span class="cat-name">全部</span></div>';
    categories.forEach(cat => {
        html += '<div class="category-item' + (currentCategory === cat.id ? ' active' : '') + '" onclick="selectCategory(' + cat.id + ')">';
        html += '<span class="cat-name">' + escapeHtml(cat.name) + '</span>';
        if (cat.is_default) html += '<span class="cat-badge">默认</span>';
        if (!cat.is_default) {
            html += '<span class="cat-actions">';
            html += '<button class="btn btn-edit" onclick="event.stopPropagation();editCategory(' + cat.id + ',\'' + escapeHtml(cat.name) + '\')">编辑</button>';
            html += '<button class="btn btn-delete" onclick="event.stopPropagation();deleteCategory(' + cat.id + ')">删除</button>';
            html += '</span>';
        }
        html += '</div>';
    });
    list.innerHTML = html;
}

function selectCategory(catId) {
    currentCategory = catId;
    currentPage = 1;
    showingExpiring = false;
    document.getElementById('expiring-sidebar').classList.remove('active');
    document.getElementById('expiring-days-selector').classList.add('hidden');
    renderCategories();
    loadItems();
    const cat = categories.find(c => c.id === catId);
    document.getElementById('content-title').textContent = cat ? cat.name : '全部物品';
}

function updateCategorySelect() {
    const select = document.getElementById('item-category');
    select.innerHTML = '<option value="">请选择分类</option>';
    categories.forEach(cat => {
        select.innerHTML += '<option value="' + cat.id + '">' + escapeHtml(cat.name) + '</option>';
    });
}

function showAddCategoryModal() {
    document.getElementById('category-modal-title').textContent = '添加分类';
    document.getElementById('category-edit-id').value = '';
    document.getElementById('category-name').value = '';
    openModal('category-modal');
}

function editCategory(id, name) {
    document.getElementById('category-modal-title').textContent = '编辑分类';
    document.getElementById('category-edit-id').value = id;
    document.getElementById('category-name').value = name;
    openModal('category-modal');
}

async function handleCategorySubmit(e) {
    e.preventDefault();
    const editId = document.getElementById('category-edit-id').value;
    const name = document.getElementById('category-name').value;
    let res;
    if (editId) {
        res = await api('PUT', '/categories/' + editId, { name });
    } else {
        res = await api('POST', '/categories', { name });
    }
    if (res) {
        showToast(editId ? '分类更新成功' : '分类创建成功', 'success');
        closeModal('category-modal');
        loadCategories();
    }
}

function deleteCategory(id) {
    document.getElementById('confirm-message').textContent = '确定要删除该分类吗？分类下有物品时无法删除。';
    document.getElementById('confirm-btn').onclick = async () => {
        const res = await api('DELETE', '/categories/' + id);
        if (res) {
            showToast('分类删除成功', 'success');
            if (currentCategory === id) { currentCategory = null; }
            loadCategories();
            loadItems();
        }
        closeModal('confirm-modal');
    };
    openModal('confirm-modal');
}

// ===== Items =====
function toggleViewMode(mode) {
    viewMode = mode;
    const gridBtn = document.getElementById('view-grid-btn');
    const listBtn = document.getElementById('view-list-btn');
    if (mode === 'grid') {
        gridBtn.classList.add('active');
        listBtn.classList.remove('active');
    } else {
        listBtn.classList.add('active');
        gridBtn.classList.remove('active');
    }
    if (showingExpiring) {
        renderExpiringView();
    } else {
        loadItems();
    }
}

async function loadItems() {
    const params = new URLSearchParams();
    params.set('page', currentPage);
    params.set('page_size', 20);
    if (currentCategory) params.set('category_id', currentCategory);
    const owner = document.getElementById('filter-owner').value;
    if (owner !== 'all') params.set('owner', owner);
    const keyword = document.getElementById('filter-keyword').value.trim();
    if (keyword) params.set('keyword', keyword);

    const res = await api('GET', '/items?' + params.toString());
    if (res) {
        renderItems(res.items || []);
        renderPagination(res.total || 0, res.page_size || 20);
    }
}

function debounceLoadItems() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { currentPage = 1; loadItems(); }, 300);
}

function renderItems(items) {
    const grid = document.getElementById('items-grid');
    grid.className = viewMode === 'list' ? 'items-list' : 'items-grid';
    if (items.length === 0) {
        grid.innerHTML = '<div class="empty-state"><div class="empty-icon">📦</div><p>暂无物品，点击右上角添加</p></div>';
        return;
    }
    if (viewMode === 'list') {
        renderItemList(items, grid);
    } else {
        renderItemGrid(items, grid);
    }
}

function renderItemGrid(items, grid) {
    let html = '';
    items.forEach(item => {
        const isExpired = new Date(item.expiry_date) < new Date();
        const expDateClass = isExpired ? 'item-expired' : '';
        html += '<div class="item-card" onclick="showItemDetail(\'' + item.id + '\')">';
        if (item.image_url) {
            html += '<img class="item-img" src="' + escapeHtml(item.image_url) + '" alt="' + escapeHtml(item.name) + '">';
        } else {
            html += '<div class="item-img-placeholder">📦</div>';
        }
        html += '<span class="item-category">' + escapeHtml(item.category_name || '未分类') + '</span>';
        html += '<div class="item-name">' + escapeHtml(item.name) + '</div>';
        html += '<div class="item-meta"><span>生产: ' + escapeHtml(item.production_date) + '</span></div>';
        html += '<div class="item-meta ' + expDateClass + '"><span>过期: ' + escapeHtml(item.expiry_date) + (isExpired ? ' (已过期)' : '') + '</span></div>';
        if (item.manufacturer) html += '<div class="item-meta"><span>厂家: ' + escapeHtml(item.manufacturer) + '</span></div>';
        html += '<div class="item-owner">';
        html += item.is_private ? '<span class="private-badge">私有</span>' : '<span class="shared-badge">组共享' + (item.ownergroup_name ? '(' + escapeHtml(item.ownergroup_name) + ')' : '') + '</span>';
        html += ' ' + escapeHtml(item.created_by_name || '');
        html += '</div>';
        html += '<div class="item-actions" onclick="event.stopPropagation()">';
        html += '<button class="btn btn-edit" onclick="editItem(\'' + item.id + '\')">编辑</button>';
        html += '<button class="btn btn-delete" onclick="deleteItem(\'' + item.id + '\')">删除</button>';
        html += '</div>';
        html += '</div>';
    });
    grid.innerHTML = html;
}

function renderItemList(items, grid) {
    let html = '<div class="list-header"><span class="lh-name">物品名称</span><span class="lh-cat">分类</span><span class="lh-prod">生产日期</span><span class="lh-exp">过期日期</span><span class="lh-owner">归属</span><span class="lh-actions">操作</span></div>';
    items.forEach(item => {
        const isExpired = new Date(item.expiry_date) < new Date();
        html += '<div class="list-row' + (isExpired ? ' row-expired' : '') + '" onclick="showItemDetail(\'' + item.id + '\')">';
        html += '<span class="lr-name">' + escapeHtml(item.name) + '</span>';
        html += '<span class="lr-cat"><span class="item-category">' + escapeHtml(item.category_name || '未分类') + '</span></span>';
        html += '<span class="lr-prod">' + escapeHtml(item.production_date) + '</span>';
        html += '<span class="lr-exp' + (isExpired ? ' item-expired' : '') + '">' + escapeHtml(item.expiry_date) + (isExpired ? ' (已过期)' : '') + '</span>';
        html += '<span class="lr-owner">' + (item.is_private ? '<span class="private-badge">私有</span>' : '<span class="shared-badge">组共享</span>') + ' ' + escapeHtml(item.created_by_name || '') + '</span>';
        html += '<span class="lr-actions" onclick="event.stopPropagation()"><button class="btn btn-edit" onclick="editItem(\'' + item.id + '\')">编辑</button> <button class="btn btn-delete" onclick="deleteItem(\'' + item.id + '\')">删除</button></span>';
        html += '</div>';
    });
    grid.innerHTML = html;
}

function renderPagination(total, pageSize) {
    const div = document.getElementById('pagination');
    totalPages = Math.ceil(total / pageSize);
    if (totalPages <= 1) { div.innerHTML = ''; return; }
    let html = '';
    html += '<button ' + (currentPage <= 1 ? 'disabled' : '') + ' onclick="goToPage(' + (currentPage - 1) + ')">上一页</button>';
    for (let i = 1; i <= totalPages; i++) {
        html += '<button class="' + (i === currentPage ? 'active' : '') + '" onclick="goToPage(' + i + ')">' + i + '</button>';
    }
    html += '<button ' + (currentPage >= totalPages ? 'disabled' : '') + ' onclick="goToPage(' + (currentPage + 1) + ')">下一页</button>';
    div.innerHTML = html;
}

function goToPage(page) {
    currentPage = page;
    loadItems();
}

// ===== Item Detail =====
async function showItemDetail(itemId) {
    const res = await api('GET', '/items/' + itemId);
    if (!res) return;
    const item = res.item;
    const isExpired = new Date(item.expiry_date) < new Date();
    let html = '';
    if (item.image_url) {
        html += '<img class="detail-image" src="' + escapeHtml(item.image_url) + '" alt="">';
    } else {
        html += '<div class="detail-image-placeholder">📦</div>';
    }
    html += '<div class="detail-grid">';
    html += '<div class="detail-item"><div class="detail-label">物品名称</div><div class="detail-value">' + escapeHtml(item.name) + '</div></div>';
    html += '<div class="detail-item"><div class="detail-label">分类</div><div class="detail-value">' + escapeHtml(item.category_name || '未分类') + '</div></div>';
    html += '<div class="detail-item"><div class="detail-label">厂家</div><div class="detail-value">' + escapeHtml(item.manufacturer || '-') + '</div></div>';
    html += '<div class="detail-item"><div class="detail-label">用途</div><div class="detail-value">' + escapeHtml(item.usage_desc || '-') + '</div></div>';
    html += '<div class="detail-item"><div class="detail-label">生产日期</div><div class="detail-value">' + escapeHtml(item.production_date) + '</div></div>';
    html += '<div class="detail-item"><div class="detail-label">过期日期</div><div class="detail-value ' + (isExpired ? 'item-expired' : '') + '">' + escapeHtml(item.expiry_date) + (isExpired ? ' (已过期)' : '') + '</div></div>';
    html += '<div class="detail-item"><div class="detail-label">归属</div><div class="detail-value">' + (item.is_private ? '私有' : '组共享' + (item.ownergroup_name ? '(' + escapeHtml(item.ownergroup_name) + ')' : '')) + '</div></div>';
    html += '<div class="detail-item"><div class="detail-label">创建者</div><div class="detail-value">' + escapeHtml(item.created_by_name || '-') + '</div></div>';
    html += '</div>';
    document.getElementById('item-detail-content').innerHTML = html;
    openModal('item-detail-modal');
}

// ===== Add/Edit Item =====
function showAddItemModal() {
    document.getElementById('item-modal-title').textContent = '添加物品';
    document.getElementById('item-edit-id').value = '';
    document.getElementById('item-name').value = '';
    document.getElementById('item-category').value = '';
    document.getElementById('item-manufacturer').value = '';
    document.getElementById('item-usage').value = '';
    document.getElementById('item-prod-date').value = '';
    document.getElementById('item-exp-date').value = '';
    document.getElementById('item-image-url').value = '';
    document.getElementById('item-image').value = '';
    const preview = document.getElementById('item-image-preview');
    preview.classList.add('hidden');
    preview.src = '';
    document.querySelector('input[name="item-private"][value="false"]').checked = true;
    openModal('item-modal');
}

async function editItem(itemId) {
    const res = await api('GET', '/items/' + itemId);
    if (!res) return;
    const item = res.item;
    document.getElementById('item-modal-title').textContent = '编辑物品';
    document.getElementById('item-edit-id').value = item.id;
    document.getElementById('item-name').value = item.name;
    document.getElementById('item-category').value = item.category_id;
    document.getElementById('item-manufacturer').value = item.manufacturer || '';
    document.getElementById('item-usage').value = item.usage_desc || '';
    document.getElementById('item-prod-date').value = item.production_date;
    document.getElementById('item-exp-date').value = item.expiry_date;
    document.getElementById('item-image-url').value = item.image_url || '';
    if (item.image_url) {
        const preview = document.getElementById('item-image-preview');
        preview.src = item.image_url;
        preview.classList.remove('hidden');
    } else {
        const preview = document.getElementById('item-image-preview');
        preview.src = '';
        preview.classList.add('hidden');
    }
    const privateRadio = document.querySelector('input[name="item-private"][value="' + item.is_private + '"]');
    if (privateRadio) privateRadio.checked = true;
    openModal('item-modal');
}

async function handleItemSubmit(e) {
    e.preventDefault();
    const editId = document.getElementById('item-edit-id').value;
    const data = {
        name: document.getElementById('item-name').value,
        category_id: parseInt(document.getElementById('item-category').value),
        manufacturer: document.getElementById('item-manufacturer').value,
        usage_desc: document.getElementById('item-usage').value,
        production_date: document.getElementById('item-prod-date').value,
        expiry_date: document.getElementById('item-exp-date').value,
        image_url: document.getElementById('item-image-url').value,
        is_private: document.querySelector('input[name="item-private"]:checked').value === 'true'
    };
    let res;
    if (editId) {
        res = await api('PUT', '/items/' + editId, data);
    } else {
        res = await api('POST', '/items', data);
    }
    if (res) {
        showToast(editId ? '物品更新成功' : '物品创建成功', 'success');
        closeModal('item-modal');
        loadItems();
    }
}

function deleteItem(itemId) {
    document.getElementById('confirm-message').textContent = '确定要删除该物品吗？此操作不可恢复。';
    document.getElementById('confirm-btn').onclick = async () => {
        const res = await api('DELETE', '/items/' + itemId);
        if (res) {
            showToast('物品删除成功', 'success');
            loadItems();
        }
        closeModal('confirm-modal');
    };
    openModal('confirm-modal');
}

// ===== Image Upload =====
async function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('image', file);
    const res = await api('POST', '/upload', formData, true);
    if (res) {
        document.getElementById('item-image-url').value = res.image_url;
        const preview = document.getElementById('item-image-preview');
        preview.src = res.image_url;
        preview.classList.remove('hidden');
        showToast('图片上传成功', 'success');
    }
}

// ===== Group =====
async function showGroupInfo() {
    const res = await api('GET', '/groups/info');
    if (!res) return;
    let html = '';
    if (res.is_group) {
        html += '<div class="group-info"><p><strong>当前账号为组账号</strong></p>';
        html += '<p>成员列表：</p>';
        if (res.members && res.members.length > 0) {
            html += '<ul class="member-list">';
            res.members.forEach(m => html += '<li>' + escapeHtml(m.username) + '</li>');
            html += '</ul>';
        } else {
            html += '<p style="color:#999">暂无成员加入</p>';
        }
        html += '</div>';
    } else if (res.group) {
        html += '<div class="group-info"><p>所属组：<strong>' + escapeHtml(res.group.name) + '</strong></p></div>';
        html += '<button class="btn btn-danger btn-small" onclick="handleLeaveGroup()" style="margin-bottom:12px">退出组</button>';
    } else {
        html += '<div class="group-info"><p style="color:#999">您还未加入任何组</p></div>';
    }
    document.getElementById('group-info-content').innerHTML = html;
    openModal('group-modal');
}

async function handleJoinGroup(e) {
    e.preventDefault();
    const groupUsername = document.getElementById('join-group-name').value;
    const res = await api('POST', '/groups/join', { group_username: groupUsername });
    if (res) {
        showToast('加入组成功', 'success');
        document.getElementById('join-group-name').value = '';
        showGroupInfo();
        loadItems();
    }
}

async function handleLeaveGroup() {
    const res = await api('POST', '/groups/leave');
    if (res) {
        showToast('退出组成功', 'success');
        showGroupInfo();
        loadItems();
    }
}

// ===== Delete Account =====
function handleDeleteAccount() {
    const password = document.getElementById('delete-account-password').value;
    if (!password) { showToast('请输入密码', 'error'); return; }
    api('DELETE', '/auth/account', { password }).then(res => {
        if (res) {
            showToast('账号已注销', 'success');
            token = '';
            currentUser = null;
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            closeModal('delete-account-modal');
            showAuthPage();
        }
    });
}

// ===== Expiry Alerts =====
async function loadExpiryAlerts() {
    const res = await api('GET', '/items/expiring?days=' + expiringDays);
    const alertEl = document.getElementById('expiry-alert');
    const countEl = document.getElementById('expiring-count-text');

    if (!res || !res.items || res.items.length === 0) {
        alertEl.classList.add('hidden');
        countEl.innerHTML = '暂无即将过期';
        document.getElementById('expiring-sidebar').classList.remove('active');
        expiringItems = [];
        if (showingExpiring) { showingExpiring = false; loadItems(); }
        return;
    }

        expiringItems = res.items;
    // Update sidebar count
    countEl.innerHTML = '即将过期 <span class="expiring-badge">' + res.items.length + '</span>';

    // Update top alert banner - simple red text reminder
    const expiredCount = res.items.filter(item => item.days_left < 0).length;
    const expiringCount = res.items.filter(item => item.days_left >= 0).length;
    let alertText = '⚠ 有';
    if (expiredCount > 0) alertText += expiredCount + '件已过期';
    if (expiredCount > 0 && expiringCount > 0) alertText += '、';
    if (expiringCount > 0) alertText += expiringCount + '件即将过期';
    alertText += '物品，点击左侧「即将过期」查看';

    let html = '<button class="expiry-alert-close" onclick="document.getElementById(\'expiry-alert\').classList.add(\'hidden\')">&times;</button>';
    html += '<div class="expiry-alert-simple" style="color:#e74c3c;font-size:16px;font-weight:700;">' + alertText + '</div>';
    alertEl.innerHTML = html;
    alertEl.classList.remove('hidden');
}

// Show expiring items in the main content area
function showExpiringItems() {
    const sidebarEl = document.getElementById('expiring-sidebar');
    if (showingExpiring) {
        // Toggle off - back to normal view
        showingExpiring = false;
        sidebarEl.classList.remove('active');
        document.getElementById('content-title').textContent = '全部物品';
        document.getElementById('expiring-days-selector').classList.add('hidden');
        document.getElementById('expiry-alert').classList.remove('hidden');
        loadItems();
        return;
    }
    showingExpiring = true;
    sidebarEl.classList.add('active');
    document.getElementById('expiry-alert').classList.add('hidden');
    renderExpiringView();
}

function renderExpiringView() {
    document.getElementById('content-title').textContent = '⚠ 即将/已过期物品';

    // Show days selector next to title
    const selectorEl = document.getElementById('expiring-days-selector');
    selectorEl.classList.remove('hidden');
    let selHtml = '<label>查询范围：</label>';
    selHtml += '<select id="expiring-days-select" onchange="changeExpiringDays()">';
    [7, 15, 30, 60, 90, 180, 365].forEach(d => {
        selHtml += '<option value="' + d + '"' + (expiringDays === d ? ' selected' : '') + '>' + d + '天</option>';
    });
    selHtml += '</select>';
    selectorEl.innerHTML = selHtml;

    const grid = document.getElementById('items-grid');
    grid.className = viewMode === 'list' ? 'items-list' : 'items-grid';
    grid.innerHTML = ''; // 清空，不要用 +=

    if (expiringItems.length === 0) {
        grid.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div><p>暂无即将过期物品</p></div>';
        document.getElementById('pagination').innerHTML = '';
        return;
    }

    if (viewMode === 'list') {
        renderExpiringItemList(grid);
    } else {
        renderExpiringItemGrid(grid);
    }
    document.getElementById('pagination').innerHTML = '';
}

function renderExpiringItemGrid(grid) {
    let html = '';
    expiringItems.forEach(item => {
        const isExpired = item.days_left < 0;
        const isToday = item.days_left === 0;
        let daysText, badgeColor, expClass;
        if (isExpired) {
            daysText = '已过期' + Math.abs(item.days_left) + '天';
            badgeColor = '#999';
            expClass = 'item-expired';
        } else if (isToday) {
            daysText = '今天过期';
            badgeColor = '#e74c3c';
            expClass = 'item-expiring-soon';
        } else if (item.days_left <= 3) {
            daysText = item.days_left + '天后过期';
            badgeColor = '#e74c3c';
            expClass = 'item-expiring-soon';
        } else {
            daysText = item.days_left + '天后过期';
            badgeColor = '#f39c12';
            expClass = '';
        }

        html += '<div class="item-card' + (isExpired ? ' card-expired' : '') + '" onclick="showItemDetail(\'' + item.id + '\')">';
        html += '<div class="item-img-placeholder">📦</div>';
        html += '<span class="item-category">' + escapeHtml(item.category_name || '未分类') + '</span>';
        html += '<div class="item-name">' + escapeHtml(item.name) + '</div>';
        html += '<div class="item-meta ' + expClass + '"><span style="color:' + badgeColor + ';font-weight:600">⏰ ' + daysText + '</span></div>';
        html += '<div class="item-meta"><span>过期: ' + escapeHtml(item.expiry_date) + '</span></div>';
        html += '<div class="item-owner">';
        html += item.is_private ? '<span class="private-badge">私有</span>' : '<span class="shared-badge">组共享</span>';
        html += ' ' + escapeHtml(item.created_by_name || '');
        html += '</div>';
        html += '</div>';
    });
    grid.innerHTML = html;
}

function renderExpiringItemList(grid) {
    let html = '<div class="list-header"><span class="lh-name">物品名称</span><span class="lh-cat">分类</span><span class="lh-exp">过期日期</span><span class="lh-days">剩余天数</span><span class="lh-owner">归属</span></div>';
    expiringItems.forEach(item => {
        const isExpired = item.days_left < 0;
        const isToday = item.days_left === 0;
        let daysText, badgeColor;
        if (isExpired) { daysText = '已过期' + Math.abs(item.days_left) + '天'; badgeColor = '#999'; }
        else if (isToday) { daysText = '今天过期'; badgeColor = '#e74c3c'; }
        else if (item.days_left <= 3) { daysText = item.days_left + '天后过期'; badgeColor = '#e74c3c'; }
        else { daysText = item.days_left + '天后过期'; badgeColor = '#f39c12'; }

        html += '<div class="list-row' + (isExpired ? ' row-expired' : '') + '" onclick="showItemDetail(\'' + item.id + '\')">';
        html += '<span class="lr-name">' + escapeHtml(item.name) + '</span>';
        html += '<span class="lr-cat"><span class="item-category">' + escapeHtml(item.category_name || '未分类') + '</span></span>';
        html += '<span class="lr-exp' + (isExpired ? ' item-expired' : '') + '">' + escapeHtml(item.expiry_date) + '</span>';
        html += '<span class="lr-days" style="color:' + badgeColor + ';font-weight:600">⏰ ' + daysText + '</span>';
        html += '<span class="lr-owner">' + (item.is_private ? '<span class="private-badge">私有</span>' : '<span class="shared-badge">组共享</span>') + ' ' + escapeHtml(item.created_by_name || '') + '</span>';
        html += '</div>';
    });
    grid.innerHTML = html;
}

async function changeExpiringDays() {
    expiringDays = parseInt(document.getElementById('expiring-days-select').value);
    const res = await api('GET', '/items/expiring?days=' + expiringDays);
    if (res && res.items) {
        expiringItems = res.items;
        // Update sidebar count
        const countEl = document.getElementById('expiring-count-text');
        if (res.items.length > 0) {
            countEl.innerHTML = '即将过期 <span class="expiring-badge">' + res.items.length + '</span>';
        } else {
            countEl.innerHTML = '暂无即将过期';
        }
    }
    renderExpiringView();
}

// ===== Utility =====
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ===== Init =====
(function init() {
    if (token && currentUser) {
        showMainPage();
    } else {
        showAuthPage();
    }
})();