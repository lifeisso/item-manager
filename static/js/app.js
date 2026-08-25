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
let expiringDays = 30; // 默认30天，实际值按用户从localStorage加载
let viewMode = 'grid'; // 'grid' 或 'list'
let showingRecycleBin = false; // 是否正在查看废物站
let showingMaintenance = false; // 是否正在查看保养提醒
let maintenancePlans = []; // 保养计划列表
let currentMaintPlanId = null; // 当前查看的保养计划ID
let maintenanceDueCount = 0; // 到期保养项数量
let showingSuggestions = false; // 是否正在查看意见箱

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
        if (res.status === 401) {
            token = '';
            currentUser = null;
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            showAuthPage();
            showToast('登录已过期，请重新登录', 'error');
            return null;
        }
        // 先检查响应类型，避免解析非JSON响应报错
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            if (!res.ok) {
                showToast('请求失败: ' + res.status + ' ' + res.statusText, 'error');
            } else {
                showToast('服务器返回了非JSON响应', 'error');
            }
            return null;
        }
        const json = await res.json();
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

async function showMainPage() {
    document.getElementById('auth-page').classList.add('hidden');
    document.getElementById('main-page').classList.remove('hidden');
    // 重置视图状态，确保每次登录默认显示"全部物品"页面
    showingExpiring = false;
    showingRecycleBin = false;
    showingMaintenance = false;
    showingSuggestions = false;
    currentMaintPlanId = null;
    document.getElementById('expiring-sidebar').classList.remove('active');
    document.getElementById('recycle-sidebar').classList.remove('active');
    document.getElementById('maintenance-sidebar').classList.remove('active');
    document.getElementById('expiring-days-selector').classList.add('hidden');
    document.getElementById('expiry-alert').classList.remove('hidden');
    document.getElementById('content-title').textContent = '全部物品';
    setViewButtons(false);
    updateUserInfo();
    await loadExpiringDays(); // 等待从服务器加载用户独立的查询范围天数
    loadCategories();
    loadItems();
    loadExpiryAlerts();
    loadRecycleBinCount();
    loadMaintenanceDueCount();
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
    expiringDays = 30; // 重置为默认值，避免影响下一个账号
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
    showingRecycleBin = false;
    showingMaintenance = false;
    document.getElementById('expiring-sidebar').classList.remove('active');
    document.getElementById('recycle-sidebar').classList.remove('active');
    document.getElementById('maintenance-sidebar').classList.remove('active');
    document.getElementById('expiring-days-selector').classList.add('hidden');
    setViewButtons(false);
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
    } else if (showingMaintenance) {
        if (currentMaintPlanId) {
            showMaintPlanDetail(currentMaintPlanId);
        } else {
            renderMaintenancePlans();
        }
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
    document.getElementById('confirm-message').textContent = '确定要删除该物品吗？物品将移入废物站。';
    document.getElementById('confirm-btn').onclick = async () => {
        const res = await api('DELETE', '/items/' + itemId);
        if (res) {
            showToast('物品已移入废物站', 'success');
            if (showingRecycleBin) {
                loadRecycleBin();
            } else {
                loadItems();
            }
            loadExpiryAlerts();
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
            expiringDays = 30;
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
async function showExpiringItems() {
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
    showingRecycleBin = false;
    showingMaintenance = false;
    document.getElementById('recycle-sidebar').classList.remove('active');
    document.getElementById('maintenance-sidebar').classList.remove('active');
    setViewButtons(false);
    sidebarEl.classList.add('active');
    document.getElementById('expiry-alert').classList.add('hidden');
    // 确保加载当前用户的天数设置
    await loadExpiringDays();
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
    await saveExpiringDays(); // 保存该用户的天数设置
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

// ===== Recycle Bin =====
let recycleItems = [];

async function loadRecycleBinCount() {
    const res = await api('GET', '/recycle-bin');
    const countEl = document.getElementById('recycle-count-text');
    if (res && res.items && res.items.length > 0) {
        countEl.innerHTML = '废物站 <span class="recycle-badge">' + res.items.length + '</span>';
    } else {
        countEl.innerHTML = '废物站';
    }
}

async function loadRecycleBin() {
    const res = await api('GET', '/recycle-bin');
    if (res) {
        recycleItems = res.items || [];
        renderRecycleBinView();
    }
}

function showRecycleBin() {
    const sidebarEl = document.getElementById('recycle-sidebar');
    if (showingRecycleBin) {
        showingRecycleBin = false;
        sidebarEl.classList.remove('active');
        document.getElementById('content-title').textContent = '全部物品';
        document.getElementById('expiry-alert').classList.remove('hidden');
        loadItems();
        return;
    }
    showingRecycleBin = true;
    showingExpiring = false;
    showingMaintenance = false;
    document.getElementById('expiring-sidebar').classList.remove('active');
    document.getElementById('maintenance-sidebar').classList.remove('active');
    setViewButtons(false);
    document.getElementById('expiring-days-selector').classList.add('hidden');
    document.getElementById('expiry-alert').classList.add('hidden');
    sidebarEl.classList.add('active');
    loadRecycleBin();
}

function renderRecycleBinView() {
    document.getElementById('content-title').textContent = '🗑️ 废物站';
    const grid = document.getElementById('items-grid');
    grid.className = 'items-list';
    document.getElementById('pagination').innerHTML = '';

    if (recycleItems.length === 0) {
        grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🗑️</div><p>废物站为空</p></div>';
        return;
    }

    let html = '<div class="recycle-actions"><button class="btn btn-delete-perm" onclick="emptyRecycleBin()">🗑️ 清空废物站</button></div>';
    html += '<div class="list-header"><span class="lh-name">物品名称</span><span class="lh-cat">分类</span><span class="lh-exp">过期日期</span><span class="lh-deleted">删除时间</span><span class="lh-owner">归属</span><span class="lh-actions">操作</span></div>';
    recycleItems.forEach(item => {
        const isExpired = new Date(item.expiry_date) < new Date();
        html += '<div class="list-row' + (isExpired ? ' row-expired' : '') + '">';
        html += '<span class="lr-name">' + escapeHtml(item.name) + '</span>';
        html += '<span class="lr-cat"><span class="item-category">' + escapeHtml(item.category_name || '未分类') + '</span></span>';
        html += '<span class="lr-exp' + (isExpired ? ' item-expired' : '') + '">' + escapeHtml(item.expiry_date) + '</span>';
        html += '<span class="lr-deleted">' + escapeHtml(item.deleted_at ? item.deleted_at.substring(0, 19).replace('T', ' ') : '') + '</span>';
        html += '<span class="lr-owner">' + (item.is_private ? '<span class="private-badge">私有</span>' : '<span class="shared-badge">组共享</span>') + '</span>';
        html += '<span class="lr-actions">';
        html += '<button class="btn btn-restore" onclick="restoreItem(\'' + item.id + '\')">恢复</button> ';
        html += '<button class="btn btn-delete-perm" onclick="permanentDeleteItem(\'' + item.id + '\')">永久删除</button>';
        html += '</span>';
        html += '</div>';
    });
    grid.innerHTML = html;
}

async function restoreItem(itemId) {
    const res = await api('PUT', '/recycle-bin/' + itemId + '/restore');
    if (res) {
        showToast('物品已恢复', 'success');
        loadRecycleBin();
        loadRecycleBinCount();
        loadExpiryAlerts();
    }
}

async function permanentDeleteItem(itemId) {
    document.getElementById('confirm-message').textContent = '确定要永久删除该物品吗？此操作不可恢复！';
    document.getElementById('confirm-btn').onclick = async () => {
        const res = await api('DELETE', '/recycle-bin/' + itemId);
        if (res) {
            showToast('物品已永久删除', 'success');
            loadRecycleBin();
            loadRecycleBinCount();
        }
        closeModal('confirm-modal');
    };
    openModal('confirm-modal');
}

async function emptyRecycleBin() {
    document.getElementById('confirm-message').textContent = '确定要清空废物站吗？所有物品将被永久删除，不可恢复！';
    document.getElementById('confirm-btn').onclick = async () => {
        const res = await api('DELETE', '/recycle-bin');
        if (res) {
            showToast('废物站已清空', 'success');
            loadRecycleBin();
            loadRecycleBinCount();
        }
        closeModal('confirm-modal');
    };
    openModal('confirm-modal');
}

// ===== User-specific Settings =====
function getExpiringDaysKey() {
    if (!currentUser || !currentUser.id) return null;
    return 'expiringDays_' + currentUser.id;
}

async function loadExpiringDays() {
    // 优先从服务器加载，localStorage 作为离线缓存
    const key = getExpiringDaysKey();
    console.log('[loadExpiringDays] key:', key, 'currentUser:', JSON.stringify(currentUser), 'expiringDays before:', expiringDays);
    const res = await api('GET', '/settings/expiring-days');
    console.log('[loadExpiringDays] API response:', JSON.stringify(res));
    if (res && typeof res.expiring_days === 'number' && res.expiring_days > 0) {
        expiringDays = res.expiring_days;
        console.log('[loadExpiringDays] Set from server:', expiringDays);
        if (key) localStorage.setItem(key, expiringDays.toString());
        return;
    }
    // 回退到 localStorage 缓存
    if (key) {
        const saved = localStorage.getItem(key);
        console.log('[loadExpiringDays] localStorage fallback, saved:', saved);
        if (saved !== null) {
            expiringDays = parseInt(saved);
        } else {
            expiringDays = 30;
        }
    } else {
        // currentUser 未设置时，重置为默认值
        expiringDays = 30;
    }
    console.log('[loadExpiringDays] Final expiringDays:', expiringDays);
}

async function saveExpiringDays() {
    // 同时保存到服务器和 localStorage
    const key = getExpiringDaysKey();
    if (key) {
        localStorage.setItem(key, expiringDays.toString());
    }
    try {
        await api('PUT', '/settings/expiring-days', { expiring_days: expiringDays });
    } catch (e) {
        // 服务器保存失败不影响本地使用，localStorage已保存
        console.warn('保存到服务器失败，已使用本地缓存:', e);
    }
}

// ===== Maintenance (保养提醒) =====

function setViewButtons(isMaintenance) {
    const isSuggestion = showingSuggestions;
    document.getElementById('btn-add-item').classList.toggle('hidden', isMaintenance || isSuggestion);
    document.getElementById('btn-add-maint-plan').classList.toggle('hidden', !isMaintenance);
    document.getElementById('view-toggle').classList.toggle('hidden', isMaintenance || isSuggestion);
}

async function loadMaintenanceDueCount() {
    const res = await api('GET', '/maintenance/due?days=7');
    if (res) {
        maintenanceDueCount = res.count || 0;
    } else {
        maintenanceDueCount = 0;
    }
    const text = document.getElementById('maintenance-count-text');
    if (maintenanceDueCount > 0) {
        text.innerHTML = '保养提醒 <span class="expiring-badge">' + maintenanceDueCount + '</span>';
    } else {
        text.textContent = '保养提醒';
    }
}

async function showMaintenanceView() {
    const sidebarEl = document.getElementById('maintenance-sidebar');
    // Toggle off
    if (showingMaintenance && !currentMaintPlanId) {
        showingMaintenance = false;
        sidebarEl.classList.remove('active');
        document.getElementById('content-title').textContent = '全部物品';
        document.getElementById('expiry-alert').classList.remove('hidden');
        setViewButtons(false);
        loadItems();
        return;
    }
    showingMaintenance = true;
    showingExpiring = false;
    showingRecycleBin = false;
    currentMaintPlanId = null;
    document.getElementById('expiring-sidebar').classList.remove('active');
    document.getElementById('recycle-sidebar').classList.remove('active');
    sidebarEl.classList.add('active');
    document.getElementById('expiring-days-selector').classList.add('hidden');
    document.getElementById('expiry-alert').classList.add('hidden');
    setViewButtons(true);
    await loadMaintenancePlans();
    renderMaintenancePlans();
}

async function loadMaintenancePlans() {
    const res = await api('GET', '/maintenance/plans');
    if (res) {
        maintenancePlans = res.plans || [];
    } else {
        maintenancePlans = [];
    }
}

function renderMaintenancePlans() {
    document.getElementById('content-title').textContent = '🔧 保养提醒';
    const grid = document.getElementById('items-grid');
    grid.className = 'items-grid';
    let html = '';

    if (maintenancePlans.length === 0) {
        html = '<div class="empty-state"><div class="empty-icon">🔧</div><p>暂无保养计划</p><p style="font-size:13px;color:#999;margin-top:8px;">点击右上角"+ 添加保养计划"开始</p></div>';
    } else {
        html += '<div style="margin-bottom:12px;">';
        maintenancePlans.forEach(plan => {
            const dueCount = plan.due_count || 0;
            const totalCount = plan.total_count || 0;
            let statsHtml = '';
            if (dueCount > 0) {
                statsHtml += '<span class="maint-stat-overdue">⚠ ' + dueCount + '项即将到期</span>';
            }
            if (totalCount - dueCount > 0) {
                statsHtml += '<span class="maint-stat-ok">✅ ' + (totalCount - dueCount) + '项正常</span>';
            }
            const nextDue = plan.next_due_date ? '最近到期: ' + plan.next_due_date : '';
            html += '<div class="maint-plan-card" onclick="showMaintPlanDetail(\'' + plan.id + '\')">';
            html += '<div class="maint-plan-header">';
            html += '<div class="maint-plan-info"><span class="maint-plan-icon">' + escapeHtml(plan.icon || '🔧') + '</span>';
            html += '<div><div class="maint-plan-name">' + escapeHtml(plan.name) + '</div>';
            if (plan.description) html += '<div class="maint-plan-desc">' + escapeHtml(plan.description) + '</div>';
            html += '</div></div>';
            html += '<div style="display:flex;gap:4px;">';
            html += '<button class="btn-maint-edit" onclick="event.stopPropagation();showEditMaintPlanModal(\'' + plan.id + '\')">编辑</button>';
            html += '<button class="btn-maint-del" onclick="event.stopPropagation();confirmDeleteMaintPlan(\'' + plan.id + '\',\'' + escapeHtml(plan.name) + '\')">删除</button>';
            html += '</div></div>';
            html += '<div class="maint-plan-stats">' + statsHtml + '</div>';
            if (nextDue) html += '<div style="font-size:12px;color:#888;margin-top:4px;">' + nextDue + '</div>';
            html += '</div>';
        });
        html += '</div>';
    }

    grid.innerHTML = html;
    document.getElementById('pagination').innerHTML = '';
}

async function showMaintPlanDetail(planId) {
    currentMaintPlanId = planId;
    const plan = maintenancePlans.find(p => p.id === planId);
    const res = await api('GET', '/maintenance/plans/' + planId + '/items');
    const items = res ? (res.items || []) : [];

    document.getElementById('content-title').textContent = (plan ? plan.icon + ' ' + plan.name : '保养详情');
    const grid = document.getElementById('items-grid');
    grid.className = 'items-grid';

    let html = '<div class="maint-detail-header">';
    html += '<div class="maint-detail-title">';
    html += '<button class="btn-back-maint" onclick="showMaintenanceView()">← 返回列表</button>';
    if (plan) html += '<span class="maint-detail-icon">' + escapeHtml(plan.icon || '🔧') + '</span><span class="maint-detail-name">' + escapeHtml(plan.name) + '</span>';
    html += '</div>';
    html += '<button class="btn btn-small btn-primary" onclick="showAddMaintItemModal(\'' + planId + '\')">+ 添加保养项</button>';
    html += '<button class="btn btn-small btn-secondary" onclick="showPlanRecords(\'' + planId + '\')">📋 查看记录</button>';
    html += '</div>';

    if (items.length === 0) {
        html += '<div class="empty-state"><div class="empty-icon">🔧</div><p>暂无保养项，点击右上角添加</p></div>';
    } else {
        html += '<div style="background:#fff;border-radius:10px;border:1px solid #e0e0e0;overflow:hidden;">';
        items.forEach(item => {
            let dueClass = 'ok';
            let dueText = '';
            if (item.is_overdue) {
                dueClass = 'overdue';
                dueText = '⚠ 已过期 ' + Math.abs(item.days_until_due) + ' 天';
            } else if (item.days_until_due <= 7) {
                dueClass = 'soon';
                dueText = item.days_until_due + ' 天后到期';
            } else {
                dueClass = 'ok';
                dueText = item.next_due_date + ' 到期';
            }
            const lastDone = item.last_done_date ? item.last_done_date : '未记录';
            html += '<div class="maint-item-row" data-item-id="' + item.id + '" data-name="' + escapeHtml(item.name) + '" data-cycle="' + item.cycle_days + '" data-last-done="' + (item.last_done_date || '') + '" data-sort="' + item.sort_order + '">';
            html += '<div class="maint-item-row-top">';
            html += '<span class="maint-item-name">' + escapeHtml(item.name) + '</span>';
            html += '<span class="maint-item-cycle">周期' + item.cycle_days + '天</span>';
            html += '<span class="maint-item-due ' + dueClass + '">' + dueText + '</span>';
            html += '</div>';
            html += '<div class="maint-item-row-bottom">';
            html += '<span class="maint-item-last-done">上次完成: ' + lastDone + '</span>';
            html += '<div class="maint-item-actions">';
            html += '<button class="btn-done" onclick="markMaintItemDone(\'' + item.id + '\')">✓ 完成</button>';
            html += '<button class="btn-maint-edit" onclick="editMaintItemFromRow(this)">编辑</button>';
            html += '<button class="btn-maint-del" onclick="deleteMaintItemFromRow(this)">删除</button>';
            html += '</div></div></div>';
        });
        html += '</div>';
    }

    grid.innerHTML = html;
    document.getElementById('pagination').innerHTML = '';
}

function editMaintItemFromRow(btn) {
    const row = btn.closest('.maint-item-row');
    const itemId = row.dataset.itemId;
    const name = row.dataset.name;
    const cycleDays = parseInt(row.dataset.cycle);
    const lastDone = row.dataset.lastDone;
    const sortOrder = parseInt(row.dataset.sort);
    showEditMaintItemModal(itemId, name, cycleDays, lastDone, sortOrder);
}

function deleteMaintItemFromRow(btn) {
    const row = btn.closest('.maint-item-row');
    const itemId = row.dataset.itemId;
    const name = row.dataset.name;
    confirmDeleteMaintItem(itemId, name);
}

// ===== Maintenance Plan Modals =====

function showAddMaintPlanModal() {
    document.getElementById('maint-plan-modal-title').textContent = '添加保养计划';
    document.getElementById('maint-plan-edit-id').value = '';
    document.getElementById('maint-plan-name').value = '';
    document.getElementById('maint-plan-desc').value = '';
    document.getElementById('maint-template-group').classList.remove('hidden');
    document.getElementById('maint-plan-template').value = '';
    // Reset icon selection
    document.querySelector('input[name="maint-plan-icon"][value="💧"]').checked = true;
    openModal('maint-plan-modal');
}

function showEditMaintPlanModal(planId) {
    const plan = maintenancePlans.find(p => p.id === planId);
    if (!plan) return;
    document.getElementById('maint-plan-modal-title').textContent = '编辑保养计划';
    document.getElementById('maint-plan-edit-id').value = planId;
    document.getElementById('maint-plan-name').value = plan.name;
    document.getElementById('maint-plan-desc').value = plan.description || '';
    document.getElementById('maint-template-group').classList.add('hidden');
    // Set icon
    const iconRadio = document.querySelector('input[name="maint-plan-icon"][value="' + (plan.icon || '🔧') + '"]');
    if (iconRadio) iconRadio.checked = true;
    openModal('maint-plan-modal');
}

async function handleMaintPlanSubmit(e) {
    e.preventDefault();
    const editId = document.getElementById('maint-plan-edit-id').value;
    const name = document.getElementById('maint-plan-name').value.trim();
    const icon = document.querySelector('input[name="maint-plan-icon"]:checked').value;
    const desc = document.getElementById('maint-plan-desc').value.trim();
    const template = document.getElementById('maint-plan-template').value;

    if (!name) { showToast('请输入设备名称', 'error'); return; }

    let res;
    if (editId) {
        res = await api('PUT', '/maintenance/plans/' + editId, { name, icon, description: desc });
    } else {
        res = await api('POST', '/maintenance/plans', { name, icon, description: desc, template });
    }

    if (res) {
        showToast(editId ? '更新成功' : '创建成功', 'success');
        closeModal('maint-plan-modal');
        await loadMaintenancePlans();
        renderMaintenancePlans();
        loadMaintenanceDueCount();
    }
}

function confirmDeleteMaintPlan(planId, planName) {
    document.getElementById('confirm-message').textContent = '确定删除保养计划"' + planName + '"及其所有保养项吗？';
    document.getElementById('confirm-btn').onclick = async () => {
        const res = await api('DELETE', '/maintenance/plans/' + planId);
        if (res) {
            showToast('删除成功', 'success');
            closeModal('confirm-modal');
            await loadMaintenancePlans();
            renderMaintenancePlans();
            loadMaintenanceDueCount();
        }
    };
    openModal('confirm-modal');
}

// ===== Maintenance Item Modals =====

function showAddMaintItemModal(planId) {
    document.getElementById('maint-item-modal-title').textContent = '添加保养项';
    document.getElementById('maint-item-edit-id').value = '';
    document.getElementById('maint-item-plan-id').value = planId;
    document.getElementById('maint-item-name').value = '';
    document.getElementById('maint-item-cycle').value = '30';
    document.getElementById('maint-item-last-done').value = '';
    document.getElementById('maint-item-sort').value = '0';
    openModal('maint-item-modal');
}

function showEditMaintItemModal(itemId, name, cycleDays, lastDone, sortOrder) {
    document.getElementById('maint-item-modal-title').textContent = '编辑保养项';
    document.getElementById('maint-item-edit-id').value = itemId;
    document.getElementById('maint-item-plan-id').value = '';
    document.getElementById('maint-item-name').value = name;
    document.getElementById('maint-item-cycle').value = cycleDays;
    document.getElementById('maint-item-last-done').value = lastDone;
    document.getElementById('maint-item-sort').value = sortOrder;
    openModal('maint-item-modal');
}

async function handleMaintItemSubmit(e) {
    e.preventDefault();
    const editId = document.getElementById('maint-item-edit-id').value;
    const planId = document.getElementById('maint-item-plan-id').value;
    const name = document.getElementById('maint-item-name').value.trim();
    const cycleDays = parseInt(document.getElementById('maint-item-cycle').value);
    const lastDone = document.getElementById('maint-item-last-done').value;
    const sortOrder = parseInt(document.getElementById('maint-item-sort').value) || 0;

    if (!name) { showToast('请输入保养项名称', 'error'); return; }
    if (!cycleDays || cycleDays < 1) { showToast('周期天数至少为1', 'error'); return; }

    let res;
    if (editId) {
        res = await api('PUT', '/maintenance/items/' + editId, { name, cycle_days: cycleDays, last_done_date: lastDone, sort_order: sortOrder });
    } else {
        res = await api('POST', '/maintenance/plans/' + planId + '/items', { name, cycle_days: cycleDays, last_done_date: lastDone, sort_order: sortOrder });
    }

    if (res) {
        showToast(editId ? '更新成功' : '添加成功', 'success');
        closeModal('maint-item-modal');
        if (currentMaintPlanId) {
            showMaintPlanDetail(currentMaintPlanId);
        } else {
            await loadMaintenancePlans();
            renderMaintenancePlans();
        }
        loadMaintenanceDueCount();
    }
}

async function markMaintItemDone(itemId) {
    const res = await api('POST', '/maintenance/items/' + itemId + '/done');
    if (res) {
        showToast('已标记完成，下次到期日期已更新', 'success');
        if (currentMaintPlanId) {
            showMaintPlanDetail(currentMaintPlanId);
        }
        loadMaintenanceDueCount();
    }
}

function confirmDeleteMaintItem(itemId, itemName) {
    document.getElementById('confirm-message').textContent = '确定删除保养项"' + itemName + '"吗？';
    document.getElementById('confirm-btn').onclick = async () => {
        const res = await api('DELETE', '/maintenance/items/' + itemId);
        if (res) {
            showToast('删除成功', 'success');
            closeModal('confirm-modal');
            if (currentMaintPlanId) {
                showMaintPlanDetail(currentMaintPlanId);
            }
            loadMaintenanceDueCount();
        }
    };
    openModal('confirm-modal');
}

// ===== Maintenance Records =====

async function showPlanRecords(planId) {
    const res = await api('GET', '/maintenance/plans/' + planId + '/records');
    if (!res) return;
    const records = res.records || [];
    const plan = maintenancePlans.find(p => p.id === planId);
    const planName = plan ? plan.icon + ' ' + plan.name : '保养记录';

    let html = '<div class="records-header"><h4>' + escapeHtml(planName) + ' - 保养记录</h4>';
    html += '<span class="records-count">共 ' + records.length + ' 条</span></div>';

    if (records.length === 0) {
        html += '<div class="empty-state"><div class="empty-icon">📋</div><p>暂无保养记录</p></div>';
    } else {
        html += '<div class="records-list">';
        records.forEach(r => {
            html += '<div class="record-item" data-record-id="' + r.id + '">';
            html += '<div class="record-info">';
            html += '<span class="record-name">' + escapeHtml(r.item_name) + '</span>';
            html += '<span class="record-date">完成日期: ' + escapeHtml(r.done_date) + '</span>';
            html += '</div>';
            html += '<button class="btn-record-del" onclick="confirmDeleteRecord(\'' + r.id + '\', \'' + escapeHtml(r.item_name) + '\')">删除</button>';
            html += '</div>';
        });
        html += '</div>';
    }

    document.getElementById('maint-records-content').innerHTML = html;
    openModal('maint-records-modal');
}

function confirmDeleteRecord(recordId, itemName) {
    closeModal('maint-records-modal');
    document.getElementById('confirm-message').textContent = '确定删除"' + itemName + '"的保养记录吗？';
    document.getElementById('confirm-btn').onclick = async () => {
        const res = await api('DELETE', '/maintenance/records/' + recordId);
        if (res) {
            showToast('记录已删除', 'success');
            closeModal('confirm-modal');
            // Re-open records modal
            if (currentMaintPlanId) {
                showPlanRecords(currentMaintPlanId);
            }
        }
    };
    openModal('confirm-modal');
}

// ===== Suggestions (意见箱) =====

function showSuggestionView() {
    showingSuggestions = true;
    showingExpiring = false;
    showingRecycleBin = false;
    showingMaintenance = false;
    setViewButtons(true);
    document.getElementById('content-title').textContent = '📮 意见箱';
    const grid = document.getElementById('items-grid');
    grid.className = 'items-grid';
    loadSuggestions();
    document.getElementById('pagination').innerHTML = '';
}

async function loadSuggestions() {
    const grid = document.getElementById('items-grid');
    grid.innerHTML = '<div class="loading">加载中...</div>';
    
    const res = await api('GET', '/suggestions');
    if (!res) {
        grid.innerHTML = '<div class="empty-state"><p>加载失败</p></div>';
        return;
    }
    const suggestions = res.suggestions || [];
    
    let html = '<div class="suggestion-toolbar">';
    html += '<button class="btn btn-primary" onclick="showAddSuggestionModal()">+ 提交意见</button>';
    html += '</div>';
    
    if (suggestions.length === 0) {
        html += '<div class="empty-state"><div class="empty-icon">📮</div><p>暂无意见，点击右上角提交</p></div>';
    } else {
        html += '<div class="suggestion-list">';
        suggestions.forEach(s => {
            html += '<div class="suggestion-card" data-id="' + s.id + '">';
            html += '<div class="suggestion-content">' + escapeHtml(s.content) + '</div>';
            if (s.file_name) {
                const fileSizeStr = s.file_size > 1048576 ? (s.file_size / 1048576).toFixed(1) + 'MB' : (s.file_size / 1024).toFixed(0) + 'KB';
                html += '<div class="suggestion-file">';
                html += '<span class="file-icon">📎</span>';
                html += '<a href="/api/suggestions/' + s.id + '/download" class="file-link">' + escapeHtml(s.file_name) + '</a>';
                html += '<span class="file-size">' + fileSizeStr + '</span>';
                html += '</div>';
            }
            html += '<div class="suggestion-meta">';
            html += '<span class="suggestion-time">' + new Date(s.created_at).toLocaleString('zh-CN') + '</span>';
            html += '<button class="btn-suggestion-del" onclick="confirmDeleteSuggestion(\'' + s.id + '\')">删除</button>';
            html += '</div>';
            html += '</div>';
        });
        html += '</div>';
    }
    
    grid.innerHTML = html;
}

function showAddSuggestionModal() {
    document.getElementById('suggestion-content').value = '';
    document.getElementById('suggestion-file').value = '';
    document.getElementById('suggestion-file-name').textContent = '';
    openModal('suggestion-modal');
}

// Show selected file name
document.addEventListener('DOMContentLoaded', function() {
    const fileInput = document.getElementById('suggestion-file');
    if (fileInput) {
        fileInput.addEventListener('change', function() {
            const nameEl = document.getElementById('suggestion-file-name');
            if (this.files && this.files[0]) {
                const size = this.files[0].size;
                const sizeStr = size > 1048576 ? (size / 1048576).toFixed(1) + 'MB' : (size / 1024).toFixed(0) + 'KB';
                nameEl.textContent = this.files[0].name + ' (' + sizeStr + ')';
            } else {
                nameEl.textContent = '';
            }
        });
    }
});

async function handleSuggestionSubmit(e) {
    e.preventDefault();
    const content = document.getElementById('suggestion-content').value.trim();
    if (!content) {
        showToast('请输入意见内容', 'error');
        return;
    }
    
    const fileInput = document.getElementById('suggestion-file');
    const formData = new FormData();
    formData.append('content', content);
    if (fileInput.files && fileInput.files[0]) {
        if (fileInput.files[0].size > 50 * 1024 * 1024) {
            showToast('文件大小不能超过50MB', 'error');
            return;
        }
        formData.append('file', fileInput.files[0]);
    }
    
    // Use fetch for multipart form data
    try {
        const response = await fetch('/api/suggestions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: formData
        });
        const data = await response.json();
        if (response.ok) {
            showToast('提交成功', 'success');
            closeModal('suggestion-modal');
            loadSuggestions();
        } else {
            showToast(data.error || '提交失败', 'error');
        }
    } catch (err) {
        showToast('提交失败', 'error');
    }
}

function confirmDeleteSuggestion(suggestionId) {
    document.getElementById('confirm-message').textContent = '确定删除此意见吗？';
    document.getElementById('confirm-btn').onclick = async () => {
        const res = await api('DELETE', '/suggestions/' + suggestionId);
        if (res) {
            showToast('删除成功', 'success');
            closeModal('confirm-modal');
            loadSuggestions();
        }
    };
    openModal('confirm-modal');
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