/**
 * Lucky Draw - Auth Helper
 */
const AUTH = {
  getToken() { return localStorage.getItem('token'); },
  setToken(token) { localStorage.setItem('token', token); },
  removeToken() { localStorage.removeItem('token'); },
  isLoggedIn() { return !!this.getToken(); },
  logout() { this.removeToken(); window.location.href = '/login'; },
  async fetchWithAuth(url, options = {}) {
    const token = this.getToken();
    if (!token) { window.location.href = '/login'; return; }
    const headers = { ...(options.headers || {}), 'Authorization': `Bearer ${token}` };
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) { this.logout(); return; }
    return res;
  },
  getSlugFromPath() {
    const match = window.location.pathname.match(/\/event\/([^/]+)/);
    return match ? match[1] : null;
  }
};
