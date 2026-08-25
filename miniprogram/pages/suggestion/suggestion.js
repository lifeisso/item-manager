const api = require('../../utils/api')
const app = getApp()

Page({
  data: {
    content: '',
    fileName: '',
    filePath: '',
    fileSize: 0,
    fileSizeStr: '',
    submitting: false,
    suggestions: [],
    loaded: false
  },

  onShow() {
    if (!app.checkLogin()) return
    this.loadSuggestions()
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value })
  },

  chooseFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'all',
      success: (res) => {
        const file = res.tempFiles[0]
        if (file.size > 50 * 1024 * 1024) {
          wx.showToast({ title: '文件不能超过50MB', icon: 'none' })
          return
        }
        const sizeStr = file.size > 1048576
          ? (file.size / 1048576).toFixed(1) + 'MB'
          : (file.size / 1024).toFixed(0) + 'KB'
        this.setData({
          fileName: file.name,
          filePath: file.path,
          fileSize: file.size,
          fileSizeStr: sizeStr
        })
      }
    })
  },

  removeFile() {
    this.setData({ fileName: '', filePath: '', fileSize: 0, fileSizeStr: '' })
  },

  async handleSubmit() {
    const content = this.data.content.trim()
    if (!content) {
      wx.showToast({ title: '请输入意见内容', icon: 'none' })
      return
    }

    this.setData({ submitting: true })

    try {
      const token = app.globalData.token
      const baseUrl = app.globalData.baseUrl

      if (this.data.filePath) {
        // Upload with file using wx.uploadFile
        const uploadRes = await new Promise((resolve, reject) => {
          wx.uploadFile({
            url: baseUrl + '/api/suggestions',
            filePath: this.data.filePath,
            name: 'file',
            formData: { content: content },
            header: { 'Authorization': 'Bearer ' + token },
            success: (res) => {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve(JSON.parse(res.data))
              } else {
                const data = JSON.parse(res.data)
                reject(new Error(data.error || '提交失败'))
              }
            },
            fail: reject
          })
        })
      } else {
        // No file, use regular POST with FormData
        // Since our API expects multipart form data, we need to use uploadFile even without file
        const uploadRes = await new Promise((resolve, reject) => {
          wx.uploadFile({
            url: baseUrl + '/api/suggestions',
            filePath: '',  // empty file path
            name: 'file',
            formData: { content: content },
            header: { 'Authorization': 'Bearer ' + token },
            success: (res) => {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve(JSON.parse(res.data))
              } else {
                const data = JSON.parse(res.data)
                reject(new Error(data.error || '提交失败'))
              }
            },
            fail: reject
          })
        })
      }

      wx.showToast({ title: '提交成功', icon: 'success' })
      this.setData({ content: '', fileName: '', filePath: '', fileSize: 0, fileSizeStr: '' })
      this.loadSuggestions()
    } catch (err) {
      wx.showToast({ title: err.message || '提交失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  async loadSuggestions() {
    const res = await api.get('/suggestions')
    if (res) {
      const suggestions = (res.suggestions || []).map(s => {
        const d = new Date(s.created_at)
        s.created_at_str = d.getFullYear() + '-' +
          String(d.getMonth() + 1).padStart(2, '0') + '-' +
          String(d.getDate()).padStart(2, '0') + ' ' +
          String(d.getHours()).padStart(2, '0') + ':' +
          String(d.getMinutes()).padStart(2, '0')
        return s
      })
      this.setData({ suggestions, loaded: true })
    }
  },

  async handleDelete(e) {
    const id = e.currentTarget.dataset.id
    const result = await wx.showModal({
      title: '确认删除',
      content: '确定删除此意见吗？',
      confirmText: '删除',
      confirmColor: '#e74c3c'
    })
    if (!result.confirm) return
    wx.showLoading({ title: '删除中...' })
    const res = await api.del('/suggestions/' + id)
    wx.hideLoading()
    if (res !== null) {
      wx.showToast({ title: '已删除', icon: 'success' })
      this.loadSuggestions()
    }
  },

  downloadFile(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name
    const token = app.globalData.token
    const baseUrl = app.globalData.baseUrl
    wx.downloadFile({
      url: baseUrl + '/api/suggestions/' + id + '/download',
      header: { 'Authorization': 'Bearer ' + token },
      success: (res) => {
        if (res.statusCode === 200) {
          wx.openDocument({
            filePath: res.tempFilePath,
            showMenu: true
          })
        }
      }
    })
  }
})