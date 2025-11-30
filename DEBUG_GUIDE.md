# Google Drive API Debug Guide

Khi gặp lỗi 500 với Google Drive API, hệ thống sẽ cung cấp detailed logging để giúp bạn debug. Đây là cách sử dụng thông tin debug:

## 📍 Nơi Tìm Debug Information

### 1. **Server Console (Terminal)**
Server logs sẽ hiển thị thông tin chi tiết:
```
[abc123] API: Files request started
[abc123] Request data: { hasAccessToken: true, accessTokenLength: 256, folderId: "root" }
[abc123] Initializing Google Drive service...
[abc123] Query: (mimeType contains 'image/') and trashed=false
[abc123] Executing drive.files.list...
[abc123] ERROR: Drive API call failed: {
  error: "invalid_grant",
  stack: "...",
  requestId: "abc123"
}
```

### 2. **Browser Console (F12)**
Client-side logs sẽ hiển thị:
```
[xyz789] CLIENT: Starting files list request {
  folderId: "root",
  hasAccessToken: true,
  accessTokenLength: 256
}
[xyz789] CLIENT: Response received {
  status: 500,
  statusText: "Internal Server Error"
}
[xyz789] CLIENT: API Error Response {
  status: 500,
  errorData: { error: "Access token expired or invalid", requestId: "abc123" }
}
```

### 3. **UI Error Display**
Error sẽ hiển thị trực tiếp trong giao diện:
- ⚠️ **Error Loading Data**
- Error message chi tiết
- Request ID để match với server logs
- Retry button để thử lại

## 🔍 Common Errors và Solutions

### 1. **Token Issues**

#### **Invalid Token**
```
Server: "Access token expired or invalid"
Client: "Access token expired or invalid"
```
**Solution:** Kết nối lại với Google Drive

#### **Missing Token**
```
Server: "Access token is required"
Client: "Failed to list files"
```
**Solution:** Re-authenticate with Google

### 2. **Permission Issues**

#### **Insufficient Permissions**
```
Server: "Access denied - insufficient permissions"
Status: 403
```
**Solution:**
- Kiểm tra Google Cloud Console permissions
- Enable Google Drive API
- Check OAuth scopes: `drive.readonly`, `drive.file`

### 3. **Quota Issues**

#### **Rate Limited**
```
Server: "Google Drive quota exceeded"
Status: 429
```
**Solution:**
- Đợi vài phút trước khi thử lại
- Check Google Drive API usage limits

### 4. **Network Issues**

#### **Timeout**
```
Client: "Request failed"
Type: "AbortError"
```
**Solution:**
- Check internet connection
- Try again with "🔄 Retry" button
- Request timeout: 30 giây

## 🛠️ Debug Steps

### **Step 1: Check Request ID**
1. Mở UI error display
2. Note Request ID (ví dụ: `abc123`)
3. Tìm matching ID trong server console

### **Step 2: Analyze Server Logs**
```bash
# Filter logs by Request ID
grep "\[abc123\]" console-output.log
```

### **Step 3: Check Client Logs**
1. Mở Browser Console (F12)
2. Tìm Request ID trong logs
3. Kiểm tra request/response details

### **Step 4: Common Debug Commands**

**Server-side:**
```bash
# Check all Drive API errors
grep "ERROR.*Drive API" console-output.log

# Check specific request
grep "\[requestId\]" console-output.log

# Check authentication issues
grep "Access token" console-output.log
```

**Client-side:**
```javascript
// In browser console
console.clear(); // Clear console
// Thực hiện action gây lỗi
// Check logs in console
```

## 📋 Error Response Format

### **Success Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "file123",
      "name": "image.jpg",
      "mimeType": "image/jpeg",
      "size": "1024000",
      "createdTime": "2024-01-01T00:00:00.000Z"
    }
  ],
  "requestId": "abc123",
  "totalFiles": 1
}
```

### **Error Response:**
```json
{
  "error": "Access token expired or invalid",
  "requestId": "abc123",
  "details": {
    "message": "invalid_grant",
    "name": "GoogleAuthError"
  }
}
```

## 🔧 Enable Debug Mode

Để enable detailed logging, đảm bảo:

1. **Environment Variables:**
```env
DEBUG=google-drive:*
```

2. **Client-side:**
```javascript
// Mở browser console và gõ:
localStorage.setItem('debug', 'true');
```

3. **Server-side:**
```javascript
// Logging đã được enable mặc định với detailed info
```

## 📞 Getting Help

Khi cần support:

1. **Collect Error Info:**
   - Request ID từ UI
   - Error message từ UI
   - Browser console logs
   - Server console logs (request ID)

2. **Share Information:**
   ```
   Error: "Access token expired or invalid"
   Request ID: abc123
   Time: 2024-01-01 12:00:00
   Action: Loading files from folder "Photos"
   ```

3. **Debug Context:**
   - Browser version
   - Operating system
   - Network conditions
   - Last successful action

## 🚀 Quick Debug Checklist

- [ ] Check browser console (F12) for client errors
- [ ] Check server console for request logs
- [ ] Note Request ID from error display
- [ ] Check Google Cloud Console API status
- [ ] Verify network connectivity
- [ ] Try "🔄 Retry" button
- [ ] Re-authenticate with Google Drive if needed

## 💡 Tips

1. **Request ID Matching:** Mỗi request có unique ID để match server/client logs
2. **Timing:** Note exact time error occurred
3. **Actions:** Document exact steps leading to error
4. **Consistency:** Reproduce error consistently if possible
5. **Environment:** Note if dev/staging/production