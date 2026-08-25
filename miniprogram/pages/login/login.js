const api = require('../../utils/api')
const app = getApp()

Page({
  data: {
    tab: 'login',
    username: '',
    password: '',
    regType: 'personal'
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab })
  },

  onUsername(e) { this.setData({ username: e.detail.value }) },
  onPassword(e) { this.setData({ password: e.detail.value }) },

  setType(e) {
    this.setData({ regType: e.currentTarget.dataset.type })
  },

  async handleLogin() {
    const { username, password } = this.data
    if (!username || !password) {
      wx.showToast({ title: '请填写用户名和密码', icon: 'none' })
      return
    }
    wx.showLoading({ title: '登录中...' })
    const res = await api.post('/auth/login', { username, password })
    wx.hideLoading()
    if (res && res.token) {
      app.setLoginInfo(res.token, res.user)
      wx.showToast({ title: '登录成功', icon: 'success' })
      setTimeout(() => {
        wx.switchTab({ url: '/pages/index/index' })
      }, 500)
    }
  },

  async handleRegister() {
    const { username, password, regType } = this.data
    if (!username || username.length < 3) {
      wx.showToast({ title: '用户名至少3个字符', icon: 'none' })
      return
    }
    if (!password || password.length < 6) {
      wx.showToast({ title: '密码至少6位', icon: 'none' })
      return
    }
    wx.showLoading({ title: '注册中...' })
    const res = await api.post('/auth/register', {
      username, password,
      is_group: regType === 'group'
    })
    wx.hideLoading()
    if (res && res.token) {
      app.setLoginInfo(res.token, res.user)
      wx.showToast({ title: '注册成功', icon: 'success' })
      setTimeout(() => {
        wx.switchTab({ url: '/pages/index/index' })
      }, 500)
    }
  }
})