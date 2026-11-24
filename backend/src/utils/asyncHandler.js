// Express 4 非同步路由包裝器，確保任何未捕捉例外都交給全域錯誤處理器
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
