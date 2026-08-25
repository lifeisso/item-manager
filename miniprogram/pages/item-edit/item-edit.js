const api = require('../../utils/api')
const app = getApp()

Page({
  data: {
    id: null,
    isEdit: false,
    name: '',
    category_id: '',
    categories: [],
    categoryIndex: 0,
    manufacturer: '',
    usage_desc: '',
    production_date: '',
    expiry_date: '',
    image_url: '',
    is_private: true
  },

  onLoad(options) {
    if (options.id) {
      this.setData({ id: options.id, isEdit: true })
      wx.setNavigationBarTitle({ title: '编辑物品' })
      this.loadItem(options.id)
    }
    this.loadCategories()
  },

  async loadCategories() {
    const res = await api.get('/categories')
    if (res) {
      const categories = res.categories || []
      this.setData({ categories })
      if (this.data.category_id) {
        const idx = categories.findIndex(c => c.id === this.data.category_id)
        if (idx >= 0) this.setData({ categoryIndex: idx })
      }
    }
  },

  async loadItem(id) {
    wx.showLoading({ title: '加载中...' })
    const res = await api.get('/items/' + id)
    wx.hideLoading()
    if (res && res.item) {
      const item = res.item
      const idx = this.data.categories.findIndex(c => c.id === item.category_id)
      this.setData({
        name: item.name || '',
        category_id: item.category_id || '',
        categoryIndex: idx >= 0 ? idx : 0,
        manufacturer: item.manufacturer || '',
        usage_desc: item.usage_desc || '',
        production_date: item.production_date || '',
        expiry_date: item.expiry_date || '',
        image_url: item.image_url || '',
        is_private: item.is_private !== undefined ? item.is_private : true
      })
    }
  },

  onName(e) { this.setData({ name: e.detail.value }) },
  onManufacturer(e) { this.setData({ manufacturer: e.detail.value }) },
  onUsage(e) { this.setData({ usage_desc: e.detail.value }) },
  onProdDate(e) { this.setData({ production_date: e.detail.value }) },
  onExpDate(e) { this.setData({ expiry_date: e.detail.value }) },

  onCategoryChange(e) {
    const idx = e.detail.value
    const category = this.data.categories[idx]
    this.setData({ categoryIndex: idx, category_id: category ? category.id : '' })
  },

  onPrivateChange(e) {
    this.setData({ is_private: e.detail.value })
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: (res) => {
        const tempFile = res.tempFiles[0].tempFilePath
        this.uploadImage(tempFile)
      }
    })
  },

  async uploadImage(filePath) {
    wx.showLoading({ title: '上传中...' })
    const header = {}
    if (app.globalData.token) {
      header['Authorization'] = 'Bearer ' + app.globalData.token
    }
    wx.uploadFile({
      url: app.globalData.baseUrl + '/api/upload',
      filePath,
      name: 'file',
      header,
      success: (res) => {
        wx.hideLoading()
        const data = JSON.parse(res.data)
        if (data && data.url) {
          this.setData({ image_url: data.url })
          wx.showToast({ title: '上传成功', icon: 'success' })
        } else {
          wx.showToast({ title: '上传失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '上传失败', icon: 'none' })
      }
    })
  },

  removeImage() {
    this.setData({ image_url: '' })
  },

  async handleSubmit() {
    const { id, isEdit, name, category_id, manufacturer, usage_desc,
            production_date, expiry_date, image_url, is_private } = this.data
    if (!name.trim()) {
      wx.showToast({ title: '请输入名称', icon: 'none' })
      return
    }
    if (!category_id) {
      wx.showToast({ title: '请选择分类', icon: 'none' })
      return
    }
    const data = {
      name: name.trim(),
      category_id,
      manufacturer: manufacturer.trim(),
      usage_desc: usage_desc.trim(),
      production_date,
      expiry_date,
      image_url,
      is_private
    }
    wx.showLoading({ title: isEdit ? '保存中...' : '添加中...' })
    const res = isEdit
      ? await api.put('/items/' + id, data)
      : await api.post('/items', data)
    wx.hideLoading()
    if (res !== null) {
      wx.showToast({ title: isEdit ? '保存成功' : '添加成功', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    }
  }
})