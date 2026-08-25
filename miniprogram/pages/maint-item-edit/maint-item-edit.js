const api = require('../../utils/api')
const app = getApp()

Page({
  data: {
    planId: '',
    itemId: '',
    isEdit: false,
    name: '',
    cycle_days: '',
    last_done_date: '',
    sort_order: 0
  },

  onLoad(options) {
    if (options.planId) {
      this.setData({ planId: options.planId })
    }
    if (options.itemId) {
      this.setData({ itemId: options.itemId, isEdit: true })
      wx.setNavigationBarTitle({ title: '编辑保养项' })
      this.loadItem(options.itemId)
    }
  },

  async loadItem(id) {
    wx.showLoading({ title: '加载中...' })
    const res = await api.get('/maintenance/plans/' + this.data.planId + '/items')
    wx.hideLoading()
    if (res) {
      const item = (res.items || []).find(i => i.id === id)
      if (item) {
        this.setData({
          name: item.name || '',
          cycle_days: item.cycle_days ? String(item.cycle_days) : '',
          last_done_date: item.last_done_date || '',
          sort_order: item.sort_order || 0
        })
      }
    }
  },

  onName(e) { this.setData({ name: e.detail.value }) },

  onCycleDays(e) { this.setData({ cycle_days: e.detail.value }) },

  onLastDoneDate(e) { this.setData({ last_done_date: e.detail.value }) },

  onSortOrder(e) { this.setData({ sort_order: Number(e.detail.value) || 0 }) },

  async handleSubmit() {
    const { planId, itemId, isEdit, name, cycle_days, last_done_date, sort_order } = this.data
    if (!name.trim()) {
      wx.showToast({ title: '请输入名称', icon: 'none' })
      return
    }
    if (!cycle_days || Number(cycle_days) <= 0) {
      wx.showToast({ title: '请输入有效的周期天数', icon: 'none' })
      return
    }
    const data = {
      name: name.trim(),
      cycle_days: Number(cycle_days),
      last_done_date: last_done_date || null,
      sort_order: sort_order
    }
    wx.showLoading({ title: isEdit ? '保存中...' : '添加中...' })
    const res = isEdit
      ? await api.put('/maintenance/items/' + itemId, data)
      : await api.post('/maintenance/plans/' + planId + '/items', data)
    wx.hideLoading()
    if (res !== null) {
      wx.showToast({ title: isEdit ? '保存成功' : '添加成功', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    }
  }
})