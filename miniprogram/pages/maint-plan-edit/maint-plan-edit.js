const api = require('../../utils/api')
const app = getApp()

Page({
  data: {
    planId: '',
    isEdit: false,
    name: '',
    icon: '🔧',
    description: '',
    template: '',
    emojiList: [
      '🔧', '🚗', '🏠', '💻', '📱', '🚲', '⌚', '🎮',
      '🧹', '🌿', '🐶', '🐱', '🏊', '🏋️', '🎵', '📷',
      '🔧', '🔩', '🛠️', '⚙️', '🧰', '🧲', '🔑', '🔒'
    ],
    showEmojiPicker: false,
    templates: [
      { label: '车辆保养', value: 'car' },
      { label: '家电维护', value: 'appliance' },
      { label: '数码设备', value: 'digital' },
      { label: '自定义', value: 'custom' }
    ],
    templateIndex: -1
  },

  onLoad(options) {
    if (options.planId) {
      this.setData({ planId: options.planId, isEdit: true })
      wx.setNavigationBarTitle({ title: '编辑保养计划' })
      this.loadPlan(options.planId)
    }
  },

  async loadPlan(id) {
    wx.showLoading({ title: '加载中...' })
    const res = await api.get('/maintenance/plans')
    wx.hideLoading()
    if (res) {
      const plan = (res.plans || []).find(p => p.id === id)
      if (plan) {
        this.setData({
          name: plan.name || '',
          icon: plan.icon || '🔧',
          description: plan.description || ''
        })
      }
    }
  },

  onName(e) { this.setData({ name: e.detail.value }) },
  onDesc(e) { this.setData({ description: e.detail.value }) },

  toggleEmojiPicker() {
    this.setData({ showEmojiPicker: !this.data.showEmojiPicker })
  },

  selectEmoji(e) {
    const icon = e.currentTarget.dataset.icon
    this.setData({ icon, showEmojiPicker: false })
  },

  onTemplateChange(e) {
    const idx = e.detail.value
    this.setData({ templateIndex: idx })
    const tpl = this.data.templates[idx]
    if (tpl) {
      this.setData({ template: tpl.value })
      if (tpl.value === 'car') {
        this.setData({ name: this.data.name || '车辆保养', icon: '🚗' })
      } else if (tpl.value === 'appliance') {
        this.setData({ name: this.data.name || '家电维护', icon: '🏠' })
      } else if (tpl.value === 'digital') {
        this.setData({ name: this.data.name || '数码设备', icon: '💻' })
      }
    }
  },

  async handleSubmit() {
    const { planId, isEdit, name, icon, description, template } = this.data
    if (!name.trim()) {
      wx.showToast({ title: '请输入计划名称', icon: 'none' })
      return
    }
    const data = { name: name.trim(), icon, description: description.trim() }
    if (!isEdit && template) {
      data.template = template
    }
    wx.showLoading({ title: isEdit ? '保存中...' : '创建中...' })
    const res = isEdit
      ? await api.put('/maintenance/plans/' + planId, data)
      : await api.post('/maintenance/plans', data)
    wx.hideLoading()
    if (res !== null) {
      wx.showToast({ title: isEdit ? '保存成功' : '创建成功', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    }
  }
})