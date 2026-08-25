const api = require('../../utils/api')
const app = getApp()

Page({
  data: {
    items: []
  },

  onLoad() {
    if (!app.checkLogin()) return
    this.loadItems()
  },

  onShow() {
    if (app.globalData.token) this.loadItems()
  },

  async loadItems() {
    wx.showLoading({ title: '加载中...' })
    const res = await api.get('/recycle-bin')
    wx.hideLoading()
    if (res) {
      this.setData({ items: res.items || [] })
    }
  },

  async handleRestore(e) {
    const id = e.currentTarget.dataset.id
    wx.showLoading({ title: '恢复中...' })
    const res = await api.put('/recycle-bin/' + id + '/restore')
    wx.hideLoading()
    if (res !== null) {
      wx.showToast({ title: '已恢复', icon: 'success' })
      this.loadItems()
    }
  },

  async handlePermanentDelete(e) {
    const id = e.currentTarget.dataset.id
    const result = await wx.showModal({
      title: '永久删除',
      content: '此操作不可恢复，确认永久删除？',
      confirmText: '永久删除',
      confirmColor: '#e74c3c'
    })
    if (!result.confirm) return
    wx.showLoading({ title: '删除中...' })
    const res = await api.del('/recycle-bin/' + id)
    wx.hideLoading()
    if (res !== null) {
      wx.showToast({ title: '已永久删除', icon: 'success' })
      this.loadItems()
    }
  },

  async handleClearAll() {
    const result = await wx.showModal({
      title: '清空废物站',
      content: '将永久删除所有物品，此操作不可恢复！',
      confirmText: '清空',
      confirmColor: '#e74c3c'
    })
    if (!result.confirm) return
    wx.showLoading({ title: '清空中...' })
    const res = await api.del('/recycle-bin')
    wx.hideLoading()
    if (res !== null) {
      wx.showToast({ title: '已清空', icon: 'success' })
      this.setData({ items: [] })
    }
  }
})