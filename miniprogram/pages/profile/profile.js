const api = require('../../utils/api')
const app = getApp()

Page({
  data: {
    user: null,
    expiringDays: 30,
    daysOptions: [7, 15, 30, 60, 90, 180, 365],
    daysIndex: 2
  },

  onShow() {
    if (!app.checkLogin()) return
    this.loadUserInfo()
    const savedDays = app.globalData.expiringDays
    const idx = this.data.daysOptions.indexOf(savedDays)
    if (idx >= 0) {
      this.setData({ daysIndex: idx, expiringDays: savedDays })
    }
  },

  async loadUserInfo() {
    const res = await api.get('/auth/me')
    if (res && res.username) {
      this.setData({ user: res })
      app.globalData.currentUser = res
    }
  },

  onDaysChange(e) {
    const idx = e.detail.value
    const days = this.data.daysOptions[idx]
    this.setData({ daysIndex: idx, expiringDays: days })
    this.saveExpiringDays(days)
  },

  async saveExpiringDays(days) {
    const res = await api.put('/settings/expiring-days', { expiring_days: days })
    if (res !== null) {
      app.globalData.expiringDays = days
      wx.showToast({ title: '已保存', icon: 'success' })
    }
  },

  // 已加入组：显示所属组并可退出；未加入组：输入组账号用户名加入
  handleJoinGroup() {
    const user = this.data.user
    if (user && user.group_name) {
      wx.showModal({
        title: '所属组',
        content: '当前所属组：' + user.group_name + '\n确定退出该组吗？',
        confirmText: '退出',
        confirmColor: '#e74c3c',
        success: async (modalRes) => {
          if (!modalRes.confirm) return
          wx.showLoading({ title: '退出中...' })
          const res = await api.post('/groups/leave')
          wx.hideLoading()
          if (res !== null) {
            wx.showToast({ title: '已退出组', icon: 'success' })
            this.loadUserInfo()
          }
        }
      })
      return
    }
    wx.showModal({
      title: '加入组',
      editable: true,
      placeholderText: '请输入组账号用户名',
      confirmText: '加入',
      success: async (modalRes) => {
        if (!modalRes.confirm) return
        const groupUsername = (modalRes.content || '').trim()
        if (!groupUsername) {
          wx.showToast({ title: '请输入组账号用户名', icon: 'none' })
          return
        }
        wx.showLoading({ title: '加入中...' })
        const res = await api.post('/groups/join', { group_username: groupUsername })
        wx.hideLoading()
        if (res !== null) {
          wx.showToast({ title: '加入成功', icon: 'success' })
          this.loadUserInfo()
        }
      }
    })
  },

  async handleLogout() {
    const result = await wx.showModal({
      title: '退出登录',
      content: '确认退出登录？',
      confirmText: '退出',
      confirmColor: '#e74c3c'
    })
    if (!result.confirm) return
    await api.post('/auth/logout')
    app.clearLoginInfo()
    wx.reLaunch({ url: '/pages/login/login' })
  },

  async handleDeleteAccount() {
    const result = await wx.showModal({
      title: '注销账号',
      content: '此操作将永久删除您的账号和所有数据，不可恢复！',
      confirmText: '注销',
      confirmColor: '#e74c3c'
    })
    if (!result.confirm) return
    // 二次确认
    const result2 = await wx.showModal({
      title: '最终确认',
      content: '真的要注销账号吗？所有数据将被永久删除！',
      confirmText: '确认注销',
      confirmColor: '#e74c3c'
    })
    if (!result2.confirm) return
    wx.showLoading({ title: '注销中...' })
    const res = await api.del('/auth/account')
    wx.hideLoading()
    if (res !== null) {
      app.clearLoginInfo()
      wx.showToast({ title: '账号已注销', icon: 'none' })
      setTimeout(() => {
        wx.reLaunch({ url: '/pages/login/login' })
      }, 1000)
    }
  },

  goRecycle() {
    wx.navigateTo({ url: '/pages/recycle/recycle' })
  },

  goSuggestion() {
    wx.navigateTo({ url: '/pages/suggestion/suggestion' })
  }
})