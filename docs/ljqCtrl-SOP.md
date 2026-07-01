# ljqCtrl 使用与坐标转换 SOP

> **must call update working ckp**：`一律使用物理坐标｜禁pyautogui｜操作前先激活窗口`

## 0. API 快速参考 (Signatures)
- `ljqCtrl.dpi_scale`: float (缩放系数 = 逻辑宽度 / 物理宽度)
- `ljqCtrl.Click(x, y=None)`: 模拟点击。支持 `Click((x, y))` 或 `Click(x, y)`
- `ljqCtrl.Press(cmd, staytime=0)`: 模拟按键。如 `Press('ctrl+c')`
- `ljqCtrl.FindBlock(fn, wrect=None, threshold=0.8)`: 找图。返回 `((center_x, center_y), is_found)`
- `ljqCtrl.GrabWindow(hwnd_or_name)`: 前台截图(先Activate), 传hwnd(int)或窗口标题子串(str), 返回PIL Image
- `ljqCtrl.GrabWindowBg(hwnd_or_name, timeout=5)`: WGC后台截图(Win10+)
- `ljqCtrl.MouseDClick(staytime=0.05)`: 鼠标双击

## 1. 环境载入
import ljqCtrl

## 1.1 TMWD 诊断入口

在 browser67 仓库内优先用项目内 doctor 验证本机 Python bridge：

```bash
npm run check:ljqctrl
```

默认只做诊断：按候选顺序探测默认 Python 命令是否能 `import ljqCtrl`，并报告
`Click`、`Press`、`FindBlock`、`GrabWindow`、`GrabWindowBg` 和 `dpi_scale`
能力以及每个候选解释器的 import 结果；不会激活窗口、点击、拖拽、截图或读写
剪贴板。GenericAgent 随附的 `ljqCtrl` 实现依赖 Win32/WGC 能力，默认面向
Windows；macOS/Linux 上通常应走 `native-os` provider。若非 Windows 机器显式
配置了可 import 的兼容实现，doctor 仍会照常识别。如果 `ljqCtrl` 安装在非默认
Python 环境，设置单个解释器：

```bash
TMWD_LJQCTRL_PYTHON=/path/to/python npm run check:ljqctrl
```

或设置按系统 `PATH` 分隔符拆分的多个候选解释器：

```bash
TMWD_LJQCTRL_PYTHON_CANDIDATES="/path/a/python:/path/b/python" npm run check:ljqctrl
```

需要把诊断变成机器本地硬门禁时才使用：

```bash
TMWD_LJQCTRL_REQUIRE=1 npm run check:ljqctrl
TMWD_LJQCTRL_REQUIRE_CAPTURE=1 npm run check:ljqctrl
TMWD_LJQCTRL_REQUIRE_EXECUTE=1 npm run check:ljqctrl
```

`TMWD_LJQCTRL_EXECUTE=1` 只开启 guarded bridge 的能力判定；实际 CAPTCHA
assist 仍要求 `confirm_physical_input:true` 和坐标确认参数。

### 1.2 上游 GenericAgent macOS reference

本项目已吸收 GenericAgent 最新 macOS 控制经验作为隔离 reference：

```text
docs/upstream/genericagent/macljqCtrl.py
docs/upstream/genericagent/ljqCtrl-notes.md
```

这些文件来自 `lsdefine/GenericAgent@c25ea7c15c4b3f217318a1d86a7ee097dfbb5085`
的 `memory/macljqCtrl.py` 等材料。它们当前不是默认生产 provider；macOS 默认仍
走 `native-os` provider (`osascript` + `cliclick`)。`npm run check:ljqctrl -- --json`
会在 macOS 上输出 `macljqctrl` 诊断，检查 `Quartz`、`AppKit`、
`ApplicationServices`、`PIL`、`cv2`、`numpy` 等可选依赖是否存在，但不会点击、
激活窗口或截图。

## 2. 核心：High-DPI 物理坐标换算
`ljqCtrl` 的 `Click/MoveTo` 接口接收的是**物理像素坐标**。
当使用 `pygetwindow` 等其他工具获取窗口位置（逻辑坐标）时，必须除以缩放系数。

- **换算公式**：`物理坐标 = 逻辑坐标 / ljqCtrl.dpi_scale`
  
## 3. 截图bbox → 屏幕物理坐标（核心公式）
```python
# ui_detect获取的都是物理坐标
# ClientToScreen拿客户区原点(逻辑) → 除dpi_scale得物理偏移
cx, cy = win32gui.ClientToScreen(hwnd, (0, 0))
ox, oy = int(cx / ljqCtrl.dpi_scale), int(cy / ljqCtrl.dpi_scale)
ljqCtrl.Click(ox + (bbox[0]+bbox[2])//2, oy + (bbox[1]+bbox[3])//2)
```
禁止全屏ImageGrab（必须针对窗口），所有逻辑坐标都要转物理。

## 4. 避坑指南
- **⚠️ 一律使用物理坐标**：传给 ljqCtrl.Click/SetCursorPos 的坐标必须是物理坐标（=截图像素坐标）。禁止传入逻辑坐标。
- **物理验证**：模拟操作前必须确保窗口已通过 `activate()` 置于前台。
- **坐标对齐**: 物理坐标 = 截图坐标；ljqCtrl 自动处理 DPI 换算，禁止手动重复计算。
- **⚠️ 窗口坐标转换陷阱**：使用 `win32gui.GetWindowRect(hwnd)` 获取的矩形包含标题栏和边框，而截图内容是客户区。点击截图内元素时，必须用 `win32gui.ClientToScreen(hwnd, (0, 0))` 获取客户区原点的屏幕坐标，再加上截图内坐标。禁止直接用 GetWindowRect 左上角 + 截图坐标。
- **⚠️ win32 DPI 坐标陷阱**：未调用 `SetProcessDPIAware()` 时，`GetWindowRect/ClientToScreen/GetClientRect` 等拿到的窗口/客户区坐标通常是**逻辑坐标**，必须进行换算！
- **FindBlock score 要保留**：上游新版 `FindBlock` 会暴露 raw `max_val`
  分数。若未来把视觉模板匹配提升为本地 provider 坐标来源，provider result
  必须保留 score / threshold / bbox，不要只返回 bool。
- **Click 后像素变化≈0 要停**：上游新版 click-check 会比较点击前后小区域像素。
  如果变化接近 0，优先判断坐标转换错误、窗口未激活或点到错误区域，禁止盲目重试。
- **macOS 裁剪图坐标转换**：`screencapture -R` 接收逻辑点，但截图结果是物理像素。
  当检测点来自 `GrabScreen(bbox)` 的裁剪图内部坐标时，用
  `CropToScreen(bbox, x, y)` 转成屏幕绝对物理坐标，本质是加上裁剪原点，不要再次
  乘/除 `dpi_scale`。
- **macOS AX 优先用于普通 UI 控件**：`AXElements` / `AXFind` / `AXPress`
  可避免坐标点击，适合桌面 app 普通按钮/菜单；AX element 会随窗口重建失效，操作前应
  重新枚举。当前本项目只把它作为 reference/diagnostic，不默认执行。
- **CAPTCHA 边界不变**：即使未来启用 AX/视觉 provider，也不能默认用 AX 或 JS/CDP
  点击验证码控件。验证码仍必须走 TMWD-owned tab、bounded region、显式确认和物理输入。
- **文本输入**：ljqCtrl 无 TypeText/SendKeys。向输入框键入文本：先点击/三击选中字段，再 `pyperclip.copy('文本'); ljqCtrl.Press('ctrl+v')`。
