const app = getApp()

/**
 * 通用API请求
 * @param {string} method - GET/POST/PUT/DELETE
 * @param {string} path - API路径（不含/api前缀）
 * @param {object} data - 请求体数据
 */
function request(method, path, data) {
  return new Promise((resolve, reject) => {
    const header = {}
    if (app.globalData.token) {
      header['Authorization'] = 'Bearer ' + app.globalData.token
    }
    if (data && method !== 'GET') {
      header['Content-Type'] = 'application/json'
    }
    wx.request({
      url: app.globalData.baseUrl + '/api' + path,
      method,
      data,
      header,
      success(res) {
        if (res.statusCode === 401) {
          app.clearLoginInfo()
          wx.navigateTo({ url: '/pages/login/login' })
          resolve(null)
          return
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data)
        } else {
          const msg = (res.data && res.data.error) || '请求失败'
          wx.showToast({ title: msg, icon: 'none' })
          resolve(null)
        }
      },
      fail(err) {
        wx.showToast({ title: '网络错误', icon: 'none' })
        reject(err)
      }
    })
  })
}

function get(path) { return request('GET', path) }
function post(path, data) { return request('POST', path, data) }
function put(path, data) { return request('PUT', path, data) }
function del(path) { return request('DELETE', path) }

module.exports = { request, get, post, put, del }