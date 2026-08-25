const api = require('../../utils/api')
const app = getApp()

Page({
  data: {
    planId: '',
    plan: null,
    items: []
  },

  onLoad(options) {
    if (options.planId) {
      this.setData({ planId: options.planId })
    }
  },

  onShow() {
    if (this.data.planId) {
      this.loadItems()
    }
  },

  async loadItems() {
    wx.showLoading({ title: '加载中...' })
    const res = await api.get('/maintenance/plans/' + this.data.planId + '/items')
    wx.hideLoading()
    if (res) {
      this.setData({ items: res.items || [] })
    }
    // Also load plan info
    const planRes = await api.get('/maintenance/plans')
    if (planRes) {
      const plan = (planRes.plans || []).find(p => p.id === this.data.planId)
      if (plan) {
        this.setData({ plan })
        wx.setNavigationBarTitle({ title: plan.name || '保养详情' })
      }
    }
  },

  async handleDone(e) {
    const id = e.currentTarget.dataset.id
    wx.showLoading({ title: '处理中...' })
    const res = await api.post('/maintenance/items/' + id + '/done')
    wx.hideLoading()
    if (res !== null) {
      wx.showToast({ title: '已完成', icon: 'success' })
      this.loadItems()
    }
  },

  goAddItem() {
    wx.navigateTo({ url: '/pages/maint-item-edit/maint-item-edit?planId=' + this.data.planId })
  },

  goRecords() {
    wx.navigateTo({ url: '/pages/maint-records/maint-records?planId=' + this.data.planId })
  },

  goEditItem(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/maint-item-edit/maint-item-edit?planId=' + this.data.planId + '&itemId=' + id })
  },

  async handleDeleteItem(e) {
    const id = e.currentTarget.dataset.id
    const result = await wx.showModal({
      title: '确认删除',
      content: '确认删除此保养项？',
      confirmText: '删除',
      confirmColor: '#e74c3c'
    })
    if (!result.confirm) return
    wx.showLoading({ title: '删除中...' })
    const res = await api.del('/maintenance/items/' + id)
    wx.hideLoading()
    if (res !== null) {
      wx.showToast({ title: '已删除', icon: 'success' })
      this.loadItems()
    }
  },

  getStatusText(item) {
    if (item.is_overdue) return '已逾期'
    if (item.days_until_due <= 3) return '即将到期'
    return '正常'
  }
})