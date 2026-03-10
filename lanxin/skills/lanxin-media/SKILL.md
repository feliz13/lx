---
name: lanxin-media
description: 蓝信媒体发送指南。教 AI 如何使用 <lximg> <lxfile> 标签发送图片和文件。系统会自动解析并上传发送。
metadata: {"clawdbot":{"emoji":"📸"}}
triggers:
  - lanxin
  - 蓝信
  - 发送图片
  - 发送文件
  - 图片
  - 本地文件
  - 本地图片
  - 文件
priority: 80
---

# 蓝信媒体发送指南

## ⚠️ 重要：你有能力发送本地图片和文件！

**当用户要求发送图片或文件时，使用 `<lximg>` 或 `<lxfile>` 标签包裹路径即可。系统会自动解析、上传并发送。**

**不要说「当前通道不支持直接发送」或「无法发送文件」！使用正确的标签格式，系统就能发送。**

---

## 📸 发送图片：`<lximg>` 标签

使用 `<lximg>` 标签包裹图片路径：

```
<lximg>图片路径</lximg>
```

### ✅ 发送本地图片示例

当用户说「发送那张图片」「把图发给我」等，输出：

```
这是你要的图片：
<lximg>/path/to/photo.jpg</lximg>
```

### ✅ 发送网络图片示例

```
这是网络上的图片：
<lximg>https://example.com/image.png</lximg>
```

### ✅ 闭合方式

支持 `</lximg>` 或 `</img>` 两种闭合方式。

---

## 📎 发送文件：`<lxfile>` 标签

使用 `<lxfile>` 标签包裹文件路径（PDF、文档等）：

```
<lxfile>文件路径</lxfile>
```

### ✅ 发送本地文件示例

```
报告已发送：
<lxfile>/path/to/report.pdf</lxfile>
```

### ✅ 发送网络文件

```
<lxfile>https://example.com/document.pdf</lxfile>
```

### ✅ 闭合方式

支持 `</lxfile>` 或 `</file>` 两种闭合方式。

---

## 📝 标签说明

| 标签 | 用途 | 闭合 |
|------|------|------|
| `<lximg>路径</lximg>` | 发送图片 | `</lximg>` 或 `</img>` |
| `<lxfile>路径</lxfile>` | 发送文件 | `</lxfile>` 或 `</file>` |

### ✅ 混合发送示例

```
这是说明文字。
<lximg>/path/to/chart.png</lximg>
详细数据见附件：
<lxfile>/path/to/data.xlsx</lxfile>
```

---

## ⚠️ 蓝信限制

| 限制 | 说明 |
|------|------|
| **文件大小** | 单文件不超过 **2MB** |
| **视频** | 暂不支持（需封面图，实现较复杂） |

---

## 🚫 错误示例（不要这样做）

❌ **错误**：说「当前通道不支持直接发送文件」
❌ **错误**：说「受限于技术限制，无法发送」
❌ **错误**：只提供路径文本，不使用标签

✅ **正确**：直接使用 `<lximg>` 或 `<lxfile>` 标签包裹路径

---

## 🎯 快速参考

| 场景 | 使用方式 |
|------|----------|
| 发送本地图片 | `<lximg>/path/to/image.jpg</lximg>` |
| 发送网络图片 | `<lximg>https://example.com/image.png</lximg>` |
| 发送文件 | `<lxfile>/path/to/file.pdf</lxfile>` |
| 告知路径（不发送） | 直接写路径文本，不使用标签 |
