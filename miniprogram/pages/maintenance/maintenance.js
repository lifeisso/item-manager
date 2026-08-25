const api = require('../../utils/api')
const app = getApp()

Page({
  data: {
    plans: [],
    dueCount: 0
  },

  onShow() {
    if (!app.checkLogin()) return
    this.loadPlans()
    this.loadDueCount()
  },

  async loadPlans() {
    wx.showLoading({ title: '加载中...' })
    const res = await api.get('/maintenance/plans')
    wx.hideLoading()
    if (res) {
      this.setData({ plans: res.plans || [] })
    }
  },

  async loadDueCount() {
    const res = await api.get('/maintenance/due?days=7')
    if (res) {
      this.setData({ dueCount: res.count || 0 })
    }
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/maint-detail/maint-detail?planId=' + id })
  },

  goAddPlan() {
    wx.navigateTo({ url: '/pages/maint-plan-edit/maint-plan-edit' })
  },

  goEditPlan(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/maint-plan-edit/maint-plan-edit?planId=' + id })
  },

  async handleDeletePlan(e) {
    const id = e.currentTarget.dataset.id
    const result = await wx.showModal({
      title: '确认删除',
      content: '删除保养计划将同时删除所有保养项，确认？',
      confirmText: '删除',
      confirmColor: '#e74c3c'
    })
    if (!result.confirm) return
    wx.showLoading({ title: '删除中...' })
    const res = await api.del('/maintenance/plans/' + id)
    wx.hideLoading()
    if (res !== null) {
      wx.showToast({ title: '已删除', icon: 'success' })
      this.loadPlans()
    }
  },

  onPullDownRefresh() {
    this.loadPlans()
    this.loadDueCount()
    wx.stopPullDownRefresh()
  }
})