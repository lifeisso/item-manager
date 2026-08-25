const api = require('../../utils/api')
const app = getApp()

Page({
  data: {
    id: '',
    item: null
  },

  onLoad(options) {
    if (options.id) {
      this.setData({ id: options.id })
      this.loadItem(options.id)
    }
  },

  onShow() {
    if (this.data.id) this.loadItem(this.data.id)
  },

  async loadItem(id) {
    wx.showLoading({ title: '加载中...' })
    const res = await api.get('/items/' + id)
    wx.hideLoading()
    if (res && res.item) {
      this.setData({ item: res.item })
    }
  },

  goEdit() {
    wx.navigateTo({ url: '/pages/item-edit/item-edit?id=' + this.data.id })
  },

  async handleDelete() {
    const res = await wx.showModal({
      title: '确认删除',
      content: '删除后物品将移入废物站，可恢复',
      confirmText: '删除',
      confirmColor: '#e74c3c'
    })
    if (!res.confirm) return
    wx.showLoading({ title: '删除中...' })
    const result = await api.del('/items/' + this.data.id)
    wx.hideLoading()
    if (result !== null) {
      wx.showToast({ title: '已移入废物站', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    }
  },

  previewImage() {
    if (this.data.item && this.data.item.image_url) {
      wx.previewImage({
        urls: [this.data.item.image_url],
        current: this.data.item.image_url
      })
    }
  },

  formatDate(dateStr) {
    if (!dateStr) return '未设置'
    return dateStr
  },

  getExpiryStatus(item) {
    if (!item || !item.expiry_date) return ''
    const now = new Date()
    const exp = new Date(item.expiry_date)
    const diff = (exp - now) / (1000 * 60 * 60 * 24)
    if (diff < 0) return 'expired'
    if (diff <= app.globalData.expiringDays) return 'expiring'
    return 'normal'
  }
})