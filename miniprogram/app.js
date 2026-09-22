App({
  globalData: {
    baseUrl: 'https://shiwuwithme.homes', // 本地开发用 127.0.0.1；真机调试需改为电脑局域网IP，生产环境改为HTTPS域名
    token: '',
    currentUser: null,
    expiringDays: 30
  },

  onLaunch() {
    // 从本地存储恢复登录状态
    const token = wx.getStorageSync('token');
    const user = wx.getStorageSync('currentUser');
    if (token && user) {
      this.globalData.token = token;
      this.globalData.currentUser = JSON.parse(user);
    }
  },

  // 检查登录状态，未登录跳转登录页
  checkLogin() {
    if (!this.globalData.token) {
      wx.navigateTo({ url: '/pages/login/login' });
      return false;
    }
    return true;
  },

  // 保存登录信息
  setLoginInfo(token, user) {
    this.globalData.token = token;
    this.globalData.currentUser = user;
    wx.setStorageSync('token', token);
    wx.setStorageSync('currentUser', JSON.stringify(user));
  },

  // 清除登录信息
  clearLoginInfo() {
    this.globalData.token = '';
    this.globalData.currentUser = null;
    this.globalData.expiringDays = 30;
    wx.removeStorageSync('token');
    wx.removeStorageSync('currentUser');
  }
})