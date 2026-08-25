const api = require('../../utils/api')
const app = getApp()

Page({
  data: {
    items: [],
    categories: [],
    currentCategory: null,
    page: 1,
    hasMore: true,
    expiringCount: 0
  },

  onShow() {
    if (!app.checkLogin()) return
    this.loadCategories()
    this.loadItems(true)
    this.loadExpiringCount()
  },

  async loadCategories() {
    const res = await api.get('/categories')
    if (res) this.setData({ categories: res.categories || [] })
  },

  async loadItems(refresh) {
    if (refresh) this.setData({ page: 1, hasMore: true })
    const { page, currentCategory } = this.data
    const params = `?page=${page}&page_size=20`
      + (currentCategory ? `&category_id=${currentCategory}` : '')
    const res = await api.get('/items' + params)
    if (res) {
      const items = refresh ? (res.items || []) : [...this.data.items, ...(res.items || [])]
      this.setData({
        items,
        hasMore: items.length < res.total,
        page: page + 1
      })
    }
  },

  async loadExpiringCount() {
    const res = await api.get('/items/expiring?days=' + app.globalData.expiringDays)
    if (res) this.setData({ expiringCount: res.items ? res.items.length : 0 })
  },

  selectCategory(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ currentCategory: id })
    this.loadItems(true)
  },

  loadMore() {
    this.loadItems(false)
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/item-detail/item-detail?id=' + e.currentTarget.dataset.id })
  },

  goAddItem() {
    wx.navigateTo({ url: '/pages/item-edit/item-edit' })
  },

  goExpiring() {
    wx.switchTab({ url: '/pages/expiring/expiring' })
  }
})