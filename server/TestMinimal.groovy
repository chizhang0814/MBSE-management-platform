/**
 * 极简诊断脚本 — 验证 MagicDraw Groovy 宏基本功能
 * 1. 创建一个 Package "EICD_Test"
 * 2. 在里面创建一个 Block "TestDevice"
 * 3. 尝试从服务器获取1条数据
 *
 * 使用: Tools > Macros > Macro Engine > 粘贴 > Run
 */

import com.nomagic.magicdraw.core.Application
import com.nomagic.magicdraw.core.Project
import com.nomagic.magicdraw.openapi.uml.SessionManager
import com.nomagic.magicdraw.openapi.uml.ModelElementsManager
import com.nomagic.uml2.ext.jmi.helpers.StereotypesHelper
import com.nomagic.uml2.ext.magicdraw.classes.mdkernel.*
import com.nomagic.uml2.ext.magicdraw.mdprofiles.*
import javax.swing.JOptionPane

def project = Application.getInstance().getProject()
if (!project) {
    JOptionPane.showMessageDialog(null, "请先打开一个MagicDraw项目!")
    return
}

def log = { msg -> Application.getInstance().getGUILog().log("[TEST] " + msg) }
def result = new StringBuilder()

// Step 1: 基本信息
result.append("=== MagicDraw 诊断 ===\n")
result.append("项目: ${project.getName()}\n")
result.append("Model: ${project.getPrimaryModel()?.getName()}\n\n")

// Step 2: 创建测试元素
SessionManager.getInstance().createSession(project, "EICD Test")
try {
    def ef = project.getElementsFactory()
    def model = project.getPrimaryModel()
    def mem = ModelElementsManager.getInstance()

    // 创建 Package
    def pkg = ef.createPackageInstance()
    pkg.setName("EICD_Test_诊断")
    mem.addElement(pkg, model)
    result.append("✓ Package 创建成功: EICD_Test_诊断\n")

    // 查找 Block stereotype
    def blockStereo = StereotypesHelper.getStereotype(project, "Block")
    result.append("Block stereotype: ${blockStereo ? '找到' : '未找到'}\n")

    // 创建 Class (Block)
    def blk = ef.createClassInstance()
    blk.setName("TestDevice_测试设备")
    mem.addElement(blk, pkg)
    if (blockStereo) StereotypesHelper.addStereotype(blk, blockStereo)
    result.append("✓ Block 创建成功: TestDevice_测试设备\n")

    // 创建 Port
    try {
        def port = ef.createPortInstance()
        port.setName("TestPort_J1")
        mem.addElement(port, blk)
        result.append("✓ Port 创建成功: TestPort_J1\n")
    } catch (Exception e) {
        result.append("✗ Port 创建失败: ${e.message}\n")
    }

    SessionManager.getInstance().closeSession(project)
    result.append("\n元素已创建! 请查看 Containment Tree:\n")
    result.append("  Model > EICD_Test_诊断 > TestDevice_测试设备\n")

} catch (Exception e) {
    SessionManager.getInstance().cancelSession(project)
    result.append("\n✗ 创建失败: ${e.getClass().simpleName}: ${e.message}\n")
    result.append(e.stackTrace.take(5).collect { "  $it" }.join("\n"))
}

// Step 3: 测试网络连接
result.append("\n\n=== 网络测试 ===\n")
try {
    def conn = new URL("http://localhost:3000/api/health").openConnection()
    conn.connectTimeout = 5000
    conn.readTimeout = 5000
    def code = conn.responseCode
    def body = conn.inputStream.getText("UTF-8")
    result.append("✓ localhost:3000 → HTTP ${code}: ${body}\n")
} catch (Exception e) {
    result.append("✗ localhost:3000 不可达: ${e.message}\n")
    result.append("  → 请确认 server 已启动 (cd server && npm run dev)\n")
}

// Step 4: 测试数据获取
try {
    def auth = "Basic " + "admin:admin123".bytes.encodeBase64().toString()
    def conn = new URL("http://localhost:3000/api/oslc/projects/41/export/devices").openConnection()
    conn.setRequestProperty("Authorization", auth)
    conn.setRequestProperty("Accept", "application/json")
    conn.connectTimeout = 10000
    conn.readTimeout = 30000
    def text = conn.inputStream.getText("UTF-8")
    // 只看前200字符判断格式
    result.append("✓ 设备数据获取成功 (${text.length()} 字节)\n")
    result.append("  前100字: ${text.take(100)}...\n")
} catch (Exception e) {
    result.append("✗ 数据获取失败: ${e.message}\n")
}

log(result.toString())
JOptionPane.showMessageDialog(null, result.toString(), "EICD 诊断结果", JOptionPane.INFORMATION_MESSAGE)
