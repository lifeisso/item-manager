const api = require('../../utils/api')
const app = getApp()

Page({
  data: {
    planId: '',
    planName: '',
    records: []
  },

  onLoad(options) {
    if (options.planId) {
      this.setData({ planId: options.planId })
    }
  },

  onShow() {
    if (this.data.planId) {
      this.loadRecords()
    }
  },

  async loadRecords() {
    wx.showLoading({ title: '加载中...' })
    const res = await api.get('/maintenance/plans/' + this.data.planId + '/records')
    wx.hideLoading()
    if (res) {
      this.setData({ records: res.records || [] })
    }
    // Load plan name
    const planRes = await api.get('/maintenance/plans')
    if (planRes) {
      const plan = (planRes.plans || []).find(p => p.id === this.data.planId)
      if (plan) {
        this.setData({ planName: (plan.icon || '') + ' ' + plan.name })
        wx.setNavigationBarTitle({ title: '保养记录' })
      }
    }
  },

  async handleDelete(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name
    const result = await wx.showModal({
      title: '确认删除',
      content: '确定删除"' + name + '"的保养记录吗？',
      confirmText: '删除',
      confirmColor: '#e74c3c'
    })
    if (!result.confirm) return
    wx.showLoading({ title: '删除中...' })
    const res = await api.del('/maintenance/records/' + id)
    wx.hideLoading()
    if (res !== null) {
      wx.showToast({ title: '已删除', icon: 'success' })
      this.loadRecords()
    }
  }
})