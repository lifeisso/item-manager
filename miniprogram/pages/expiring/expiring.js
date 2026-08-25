const api = require('../../utils/api')
const app = getApp()

Page({
  data: {
    daysOptions: [7, 15, 30, 60, 90, 180, 365],
    daysIndex: 2,
    days: 30,
    items: []
  },

  onShow() {
    if (!app.checkLogin()) return
    const savedDays = app.globalData.expiringDays
    const idx = this.data.daysOptions.indexOf(savedDays)
    if (idx >= 0) {
      this.setData({ daysIndex: idx, days: savedDays })
    }
    this.loadItems()
  },

  onDaysChange(e) {
    const idx = e.detail.value
    const days = this.data.daysOptions[idx]
    this.setData({ daysIndex: idx, days })
    app.globalData.expiringDays = days
    this.loadItems()
  },

  async loadItems() {
    wx.showLoading({ title: '加载中...' })
    const res = await api.get('/items/expiring?days=' + this.data.days)
    wx.hideLoading()
    if (res) {
      this.setData({ items: res.items || [] })
    }
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/item-detail/item-detail?id=' + e.currentTarget.dataset.id })
  },

  getDaysLeft(expiryDate) {
    if (!expiryDate) return ''
    const now = new Date()
    const exp = new Date(expiryDate)
    const diff = Math.ceil((exp - now) / (1000 * 60 * 60 * 24))
    if (diff < 0) return '已过期' + Math.abs(diff) + '天'
    if (diff === 0) return '今天过期'
    return diff + '天后过期'
  }
})