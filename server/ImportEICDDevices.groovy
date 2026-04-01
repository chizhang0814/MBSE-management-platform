/**
 * EICD全量数据导入MagicDraw脚本（设备/连接器/针脚/信号 + IBD图）
 * ================================================================
 * SysML映射:
 *   设备     → Block (CE25A飞行器的part property)  + EICDDevice stereotype
 *   连接器   → Port (设备Block上的端口)             + EICDConnector stereotype
 *   针脚     → 嵌套Port (连接器类型Block上)          + EICDPin stereotype
 *   信号     → Connector (CE25A内部连线)            + EICDSignal stereotype
 *   IBD图    → 每个设备一张，显示设备+关联设备+连接关系
 *
 * 使用: Tools > Macros > Macro Engine > 粘贴 > Run
 */

import com.nomagic.magicdraw.core.Application
import com.nomagic.magicdraw.core.Project
import com.nomagic.magicdraw.openapi.uml.SessionManager
import com.nomagic.magicdraw.openapi.uml.ModelElementsManager
import com.nomagic.magicdraw.openapi.uml.PresentationElementsManager
import com.nomagic.uml2.ext.jmi.helpers.StereotypesHelper
import com.nomagic.uml2.ext.magicdraw.classes.mdkernel.*
import com.nomagic.uml2.ext.magicdraw.classes.mdkernel.AggregationKindEnum
import com.nomagic.uml2.ext.magicdraw.compositestructures.mdinternalstructures.*
import com.nomagic.uml2.ext.magicdraw.compositestructures.mdports.*
import com.nomagic.uml2.ext.magicdraw.mdprofiles.*
import javax.swing.JOptionPane
import java.awt.Rectangle

// ======================== 配置项 ========================

def API_BASE = "http://localhost:3000/api/oslc/projects/41/export"
def USERNAME = "admin"
def PASSWORD = "admin123"
def CE25A_NAME     = "CE25A飞行器"
def DEV_PKG_NAME   = "EICD设备"
def CONN_PKG_NAME  = "EICD连接器类型"
def PROFILE_NAME   = "EICD Profile"

def SYS_FIELDS = [
    "id", "project_id", "created_at", "updated_at", "created_by",
    "导入来源", "import_conflicts", "import_status", "version",
    "validation_errors", "pending_item_type"
] as Set

// ======================== 内嵌JSON解析器 ========================

class MiniJson {
    char[] c; int i = 0
    MiniJson(String s) { c = s.toCharArray() }
    void ws() { while (i < c.length && c[i] <= (char)' ') i++ }
    def parseValue() {
        ws()
        if (i >= c.length) return null
        switch (c[i]) {
            case (char)'{': return parseObj()
            case (char)'[': return parseArr()
            case (char)'"': return parseStr()
            case (char)'t': i += 4; return true
            case (char)'f': i += 5; return false
            case (char)'n': i += 4; return null
            default: return parseNum()
        }
    }
    Map parseObj() {
        def m = new LinkedHashMap(); i++
        ws(); if (c[i] == (char)'}') { i++; return m }
        while (true) {
            ws(); def k = parseStr(); ws(); i++
            m[k] = parseValue(); ws()
            if (c[i] == (char)',') { i++; continue }
            i++; break
        }
        return m
    }
    List parseArr() {
        def a = []; i++
        ws(); if (c[i] == (char)']') { i++; return a }
        while (true) {
            a.add(parseValue()); ws()
            if (c[i] == (char)',') { i++; continue }
            i++; break
        }
        return a
    }
    String parseStr() {
        i++; def sb = new StringBuilder()
        while (c[i] != (char)'"') {
            if (c[i] == (char)'\\') {
                i++
                switch (c[i]) {
                    case (char)'n': sb.append('\n'); break
                    case (char)'r': sb.append('\r'); break
                    case (char)'t': sb.append('\t'); break
                    case (char)'u':
                        sb.append((char) Integer.parseInt(new String(c, i+1, 4), 16))
                        i += 4; break
                    default: sb.append(c[i])
                }
            } else { sb.append(c[i]) }
            i++
        }
        i++; return sb.toString()
    }
    def parseNum() {
        int s = i
        if (c[i] == (char)'-') i++
        while (i < c.length && c[i] >= (char)'0' && c[i] <= (char)'9') i++
        boolean flt = false
        if (i < c.length && c[i] == (char)'.') { flt = true; i++; while (i < c.length && c[i] >= (char)'0' && c[i] <= (char)'9') i++ }
        if (i < c.length && (c[i] == (char)'e' || c[i] == (char)'E')) { flt = true; i++; if (i < c.length && (c[i] == (char)'+' || c[i] == (char)'-')) i++; while (i < c.length && c[i] >= (char)'0' && c[i] <= (char)'9') i++ }
        def n = new String(c, s, i - s)
        return flt ? Double.parseDouble(n) : Long.parseLong(n)
    }
}

// ======================== 辅助函数 ========================

def fetchJson(String url, String authHeader) {
    def conn = new URL(url).openConnection()
    conn.setRequestProperty("Authorization", authHeader)
    conn.setRequestProperty("Accept", "application/json")
    conn.connectTimeout = 30000
    conn.readTimeout = 120000
    return new MiniJson(conn.inputStream.getText("UTF-8")).parseValue()
}

def collectFields(List records, Set skip) {
    def fields = new LinkedHashSet()
    records.each { r -> r.keySet().each { k -> if (!skip.contains(k)) fields.add(k) } }
    return fields
}

def toLong(val) {
    if (val == null) return null
    if (val instanceof Number) return val.longValue()
    try { return Long.parseLong(val.toString()) } catch (e) { return null }
}

def setTagValues(element, stereotype, fields, record) {
    fields.each { fn ->
        def val = record[fn]
        if (val != null) {
            def sv = val.toString().trim()
            if (sv && sv != "null") {
                try { StereotypesHelper.setStereotypePropertyValue(element, stereotype, fn, sv) } catch (ignored) {}
            }
        }
    }
}

// ======================== 主脚本 ========================

def project = Application.getInstance().getProject()
if (!project) { JOptionPane.showMessageDialog(null, "请先打开MagicDraw项目!"); return }
def log = { msg -> Application.getInstance().getGUILog().log("[EICD] " + msg) }

log("========== EICD全量数据导入（含IBD图）==========")

// ---------- 1. 拉取全部数据 ----------
def auth = "Basic " + "${USERNAME}:${PASSWORD}".bytes.encodeBase64().toString()
log("正在拉取数据...")
def devData, connData, pinData, sigData, epData
try {
    devData  = fetchJson("${API_BASE}/devices", auth)
    connData = fetchJson("${API_BASE}/connectors", auth)
    pinData  = fetchJson("${API_BASE}/pins", auth)
    sigData  = fetchJson("${API_BASE}/signals", auth)
    epData   = fetchJson("${API_BASE}/signal_endpoints", auth)
} catch (Exception e) {
    JOptionPane.showMessageDialog(null, "拉取数据失败: ${e.message}\n\n请确认服务器在运行 (localhost:3000)")
    return
}

def devices    = devData.results
def connectors = connData.results
def pins       = pinData.results
def signals    = sigData.results
def endpoints  = epData.results
log("数据: ${devices.size()}设备, ${connectors.size()}连接器, ${pins.size()}针脚, ${signals.size()}信号, ${endpoints.size()}端点")

// ---------- 2. 构建索引 ----------
def connById = new HashMap()
connectors.each { c -> def id = toLong(c["id"]); if (id) connById[id] = c }

def connsByDevId = new HashMap()
connectors.each { c ->
    def did = toLong(c["device_id"])
    if (did) connsByDevId.computeIfAbsent(did, { [] }).add(c)
}

def pinById = new HashMap()
pins.each { p -> def id = toLong(p["id"]); if (id) pinById[id] = p }

def pinsByConnId = new HashMap()
pins.each { p ->
    def cid = toLong(p["connector_id"])
    if (cid) pinsByConnId.computeIfAbsent(cid, { [] }).add(p)
}

def epsBySigId = new HashMap()
endpoints.each { ep ->
    def sid = toLong(ep["signal_id"])
    if (sid && toLong(ep["pin_id"])) epsBySigId.computeIfAbsent(sid, { [] }).add(ep)
}

def devFields  = collectFields(devices, SYS_FIELDS)
def connFields = collectFields(connectors, SYS_FIELDS + ["device_id"] as Set)
def pinFields  = collectFields(pins, SYS_FIELDS + ["connector_id"] as Set)
def sigFields  = collectFields(signals, SYS_FIELDS)
def sigExtraFields = ["信号名称_端1", "信号定义_端1", "信号名称_端2", "信号定义_端2"] as LinkedHashSet

// 构建设备连接关系索引（从数据层面，不依赖模型元素）
// deviceConns[devId] = [{sigId, myPinId, myConnId, otherDevId, otherPinId, otherConnId, sigName, sigDbObj}]
def deviceConns = new HashMap()
signals.each { sig ->
    def sigId = toLong(sig["id"])
    def eps = epsBySigId[sigId]
    if (!eps || eps.size() < 2) return
    eps.sort { toLong(it["endpoint_index"]) ?: 0 }
    def ep1 = eps[0], ep2 = eps[1]
    def devId1 = toLong(ep1["device_id"]), devId2 = toLong(ep2["device_id"])
    def pinId1 = toLong(ep1["pin_id"]), pinId2 = toLong(ep2["pin_id"])
    if (!devId1 || !devId2 || !pinId1 || !pinId2) return
    def pin1Rec = pinById[pinId1], pin2Rec = pinById[pinId2]
    def connId1 = pin1Rec ? toLong(pin1Rec["connector_id"]) : null
    def connId2 = pin2Rec ? toLong(pin2Rec["connector_id"]) : null

    deviceConns.computeIfAbsent(devId1, { [] }).add([
        sigId: sigId, myPinId: pinId1, myConnId: connId1,
        otherDevId: devId2, otherPinId: pinId2, otherConnId: connId2,
        sigName: (ep1["信号名称"] ?: sig["unique_id"] ?: "").toString()
    ])
    deviceConns.computeIfAbsent(devId2, { [] }).add([
        sigId: sigId, myPinId: pinId2, myConnId: connId2,
        otherDevId: devId1, otherPinId: pinId1, otherConnId: connId1,
        sigName: (ep2["信号名称"] ?: sig["unique_id"] ?: "").toString()
    ])
}
log("连接关系索引: ${deviceConns.size()}个设备有信号连接")

// ================================================================
// SESSION 1: 创建模型元素
// ================================================================
SessionManager.getInstance().createSession(project, "Import EICD Model Elements")

def deviceIdToBlock = new HashMap()
def deviceIdToPart  = new HashMap()
def connIdToTypeBlock = new HashMap()
def connIdToPort    = new HashMap()
def pinIdToPort     = new HashMap()
def sigIdToSysmlConn = new HashMap()
def ce25a = null

try {
    def ef    = project.getElementsFactory()
    def model = project.getPrimaryModel()
    def mem   = ModelElementsManager.getInstance()

    // ===== Profile + Stereotype =====
    log("创建Profile和Stereotype...")
    def profile = model.ownedElement.find { it instanceof Profile && it.name == PROFILE_NAME }
    if (!profile) {
        profile = ef.createProfileInstance()
        profile.setName(PROFILE_NAME)
        mem.addElement(profile, model)
    }

    def classMetaclass = null, portMetaclass = null, connectorMetaclass = null
    try { classMetaclass     = StereotypesHelper.getMetaClassByName(project, "Class") } catch (ignored) {}
    try { portMetaclass      = StereotypesHelper.getMetaClassByName(project, "Port") } catch (ignored) {}
    try { connectorMetaclass = StereotypesHelper.getMetaClassByName(project, "Connector") } catch (ignored) {}

    def getOrCreateStereo = { String name, metaclass, Set fieldSet ->
        def s = StereotypesHelper.getStereotype(project, name, profile)
        if (!s) {
            s = ef.createStereotypeInstance()
            s.setName(name)
            mem.addElement(s, profile)
            if (metaclass) try { StereotypesHelper.createExtension(s, metaclass, false) } catch (ignored) {}
        }
        def existing = s.ownedAttribute.collect { it.name } as Set
        fieldSet.each { fn ->
            if (!existing.contains(fn)) { def td = ef.createPropertyInstance(); td.setName(fn); td.setOwner(s) }
        }
        return s
    }

    def devStereo  = getOrCreateStereo("EICDDevice", classMetaclass, devFields)
    def connStereo = getOrCreateStereo("EICDConnector", classMetaclass, connFields)
    def pinStereo  = getOrCreateStereo("EICDPin", portMetaclass ?: classMetaclass, pinFields)
    def sigStereo  = getOrCreateStereo("EICDSignal", connectorMetaclass ?: classMetaclass, sigFields + sigExtraFields)

    def blockStereo = StereotypesHelper.getStereotype(project, "Block")

    // ===== Package + CE25A =====
    def findOrCreatePkg = { String name, parent ->
        def pkg = parent.ownedElement.find { it instanceof Package && !(it instanceof Profile) && it.name == name }
        if (!pkg) { pkg = ef.createPackageInstance(); pkg.setName(name); mem.addElement(pkg, parent) }
        return pkg
    }
    def devPkg  = findOrCreatePkg(DEV_PKG_NAME, model)
    def connPkg = findOrCreatePkg(CONN_PKG_NAME, model)

    ce25a = null
    devPkg.ownedElement.each { el ->
        if (el.getName() == CE25A_NAME && el instanceof com.nomagic.uml2.ext.magicdraw.classes.mdkernel.Class) ce25a = el
    }
    if (!ce25a) {
        ce25a = ef.createClassInstance()
        ce25a.setName(CE25A_NAME)
        mem.addElement(ce25a, devPkg)
        if (blockStereo) StereotypesHelper.addStereotype(ce25a, blockStereo)
        log("创建顶层Block: ${CE25A_NAME}")
    }

    // ===== COMPOSITE检测 =====
    def COMPOSITE = null
    try { COMPOSITE = AggregationKindEnum.COMPOSITE } catch (ignored) {}
    if (!COMPOSITE) try { COMPOSITE = Class.forName("com.nomagic.uml2.ext.magicdraw.classes.mdkernel.AggregationKindEnum").getField("COMPOSITE").get(null) } catch (ignored) {}
    if (!COMPOSITE) try { COMPOSITE = Class.forName("com.nomagic.uml2.ext.magicdraw.classes.mdkernel.AggregationKind").getField("COMPOSITE").get(null) } catch (ignored) {}

    // ===== 设备Block + Part =====
    log("创建设备Block+Part (${devices.size()})...")
    def devCreated = 0, partCreated = 0

    devices.each { dev ->
        def devId   = toLong(dev["id"])
        def devCode = (dev["设备编号"] ?: "DEV_${devId}").toString().trim()
        def devName = (dev["设备中文名称"] ?: "").toString().trim()
        def blockName = devName ? "${devCode} ${devName}" : devCode

        def block = ef.createClassInstance()
        block.setName(blockName)
        mem.addElement(block, devPkg)
        if (blockStereo) StereotypesHelper.addStereotype(block, blockStereo)
        StereotypesHelper.addStereotype(block, devStereo)
        setTagValues(block, devStereo, devFields, dev)
        deviceIdToBlock[devId] = block
        devCreated++

        try {
            def part = ef.createPropertyInstance()
            part.setName(devCode)
            part.setType(block)
            if (COMPOSITE) part.setAggregation(COMPOSITE)
            mem.addElement(part, ce25a)
            deviceIdToPart[devId] = part
            partCreated++
        } catch (ignored) {}
        if (devCreated % 50 == 0) log("  设备: ${devCreated}/${devices.size()}")
    }
    log("设备: ${devCreated} Block, ${partCreated} Part")

    // ===== 连接器 =====
    log("创建连接器 (${connectors.size()})...")
    def connCreated = 0
    connectors.each { conn ->
        def connId = toLong(conn["id"]), devId = toLong(conn["device_id"])
        def connCode = (conn["设备端元器件编号"] ?: "CONN_${connId}").toString().trim()
        def devBlock = deviceIdToBlock[devId]
        if (!devBlock) return

        def typeBlock = ef.createClassInstance()
        typeBlock.setName(connCode)
        mem.addElement(typeBlock, connPkg)
        if (blockStereo) StereotypesHelper.addStereotype(typeBlock, blockStereo)
        StereotypesHelper.addStereotype(typeBlock, connStereo)
        setTagValues(typeBlock, connStereo, connFields, conn)
        connIdToTypeBlock[connId] = typeBlock

        try {
            def port = ef.createPortInstance()
            port.setName(connCode)
            port.setType(typeBlock)
            mem.addElement(port, devBlock)
            connIdToPort[connId] = port
        } catch (e) {
            try { def p = ef.createPropertyInstance(); p.setName(connCode); p.setType(typeBlock); mem.addElement(p, devBlock); connIdToPort[connId] = p } catch (ignored) {}
        }
        connCreated++
        if (connCreated % 100 == 0) log("  连接器: ${connCreated}/${connectors.size()}")
    }
    log("连接器: ${connCreated}")

    // ===== 针脚 =====
    log("创建针脚 (${pins.size()})...")
    def pinCreated = 0
    pins.each { pin ->
        def pinId = toLong(pin["id"]), connId = toLong(pin["connector_id"])
        def pinCode = (pin["针孔号"] ?: "PIN_${pinId}").toString().trim()
        def typeBlock = connIdToTypeBlock[connId]
        if (!typeBlock) return
        try {
            def pp = ef.createPortInstance(); pp.setName(pinCode); mem.addElement(pp, typeBlock)
            StereotypesHelper.addStereotype(pp, pinStereo)
            setTagValues(pp, pinStereo, pinFields, pin)
            pinIdToPort[pinId] = pp
        } catch (e) {
            try { def pp = ef.createPropertyInstance(); pp.setName(pinCode); mem.addElement(pp, typeBlock); pinIdToPort[pinId] = pp } catch (ignored) {}
        }
        pinCreated++
        if (pinCreated % 500 == 0) log("  针脚: ${pinCreated}/${pins.size()}")
    }
    log("针脚: ${pinCreated}")

    // ===== 信号Connector =====
    // 信号连接的是针脚（pin Port，嵌套在连接器Port内的Port）
    // 需要 NestedConnectorEnd stereotype + propertyPath 来支持嵌套端口引用
    log("创建信号Connector (${signals.size()})...")
    def sigCreated = 0, sigSkipped = 0, sigErrors = 0

    // 查找 SysML NestedConnectorEnd stereotype
    def nceStereo = StereotypesHelper.getStereotype(project, "NestedConnectorEnd")
    if (nceStereo) {
        log("找到 NestedConnectorEnd stereotype")
    } else {
        log("WARN: 未找到 NestedConnectorEnd stereotype，将使用连接器Port级别连接")
    }

    // 增加 sigExtraFields 中的 pin 信息字段
    def pinInfoFields = ["针孔号_端1", "针孔号_端2", "连接器编号_端1", "连接器编号_端2"] as LinkedHashSet
    // 确保 stereotype 有这些属性
    (sigExtraFields + pinInfoFields).each { fn ->
        if (!sigStereo.ownedAttribute.any { it.name == fn }) {
            def td = ef.createPropertyInstance(); td.setName(fn); td.setOwner(sigStereo)
        }
    }

    signals.each { sig ->
        def sigId = toLong(sig["id"])
        def eps = epsBySigId[sigId]
        if (!eps || eps.size() < 2) { sigSkipped++; return }
        eps.sort { toLong(it["endpoint_index"]) ?: 0 }
        def ep1 = eps[0], ep2 = eps[1]

        def pinId1 = toLong(ep1["pin_id"]), pinId2 = toLong(ep2["pin_id"])
        def devId1 = toLong(ep1["device_id"]), devId2 = toLong(ep2["device_id"])
        def devPart1 = deviceIdToPart[devId1]
        def devPart2 = deviceIdToPart[devId2]
        if (!devPart1 || !devPart2) { sigSkipped++; return }

        // 找针脚Port（role）和连接器Port（propertyPath中间层级）
        def pinPort1 = pinIdToPort[pinId1], pinPort2 = pinIdToPort[pinId2]
        def pin1Rec = pinById[pinId1], pin2Rec = pinById[pinId2]
        def connId1 = pin1Rec ? toLong(pin1Rec["connector_id"]) : null
        def connId2 = pin2Rec ? toLong(pin2Rec["connector_id"]) : null
        def connPort1 = connId1 ? connIdToPort[connId1] : null
        def connPort2 = connId2 ? connIdToPort[connId2] : null

        // 至少要有pin port；如果pin port缺失，fallback到connector port
        def role1 = pinPort1 ?: connPort1
        def role2 = pinPort2 ?: connPort2
        if (!role1 || !role2) { sigSkipped++; return }

        try {
            def sigName = (ep1["信号名称"] ?: sig["unique_id"] ?: "SIG_${sigId}").toString()
            def sc = ef.createConnectorInstance()
            sc.setName(sigName)
            sc.setOwner(ce25a)

            // createConnectorInstance() 自动创建 2 个 ConnectorEnd
            def ends = sc.getEnd()
            def end1 = ends.get(0)
            def end2 = ends.get(1)

            end1.setRole(role1)
            end1.setPartWithPort(devPart1)
            end2.setRole(role2)
            end2.setPartWithPort(devPart2)

            // 如果连接的是嵌套pin Port，需要设置 NestedConnectorEnd 的 propertyPath
            // propertyPath = [connectorPort]，表示从 devPart 经过 connectorPort 到达 pinPort
            if (nceStereo && pinPort1 && connPort1) {
                try {
                    StereotypesHelper.addStereotype(end1, nceStereo)
                    StereotypesHelper.setStereotypePropertyValue(end1, nceStereo, "propertyPath", [connPort1])
                } catch (ignored) {}
            }
            if (nceStereo && pinPort2 && connPort2) {
                try {
                    StereotypesHelper.addStereotype(end2, nceStereo)
                    StereotypesHelper.setStereotypePropertyValue(end2, nceStereo, "propertyPath", [connPort2])
                } catch (ignored) {}
            }

            StereotypesHelper.addStereotype(sc, sigStereo)
            setTagValues(sc, sigStereo, sigFields, sig)
            // 保留端点信号名称、信号定义
            try {
                if (ep1["信号名称"]) StereotypesHelper.setStereotypePropertyValue(sc, sigStereo, "信号名称_端1", ep1["信号名称"].toString())
                if (ep1["信号定义"]) StereotypesHelper.setStereotypePropertyValue(sc, sigStereo, "信号定义_端1", ep1["信号定义"].toString())
                if (ep2["信号名称"]) StereotypesHelper.setStereotypePropertyValue(sc, sigStereo, "信号名称_端2", ep2["信号名称"].toString())
                if (ep2["信号定义"]) StereotypesHelper.setStereotypePropertyValue(sc, sigStereo, "信号定义_端2", ep2["信号定义"].toString())
            } catch (ignored) {}
            // 保留针脚号和连接器编号信息到tag
            try {
                def pinCode1 = pin1Rec ? (pin1Rec["针孔号"] ?: "").toString() : ""
                def pinCode2 = pin2Rec ? (pin2Rec["针孔号"] ?: "").toString() : ""
                def connRec1 = connId1 ? connById[connId1] : null
                def connRec2 = connId2 ? connById[connId2] : null
                def connCode1 = connRec1 ? (connRec1["设备端元器件编号"] ?: "").toString() : ""
                def connCode2 = connRec2 ? (connRec2["设备端元器件编号"] ?: "").toString() : ""
                if (pinCode1) StereotypesHelper.setStereotypePropertyValue(sc, sigStereo, "针孔号_端1", pinCode1)
                if (pinCode2) StereotypesHelper.setStereotypePropertyValue(sc, sigStereo, "针孔号_端2", pinCode2)
                if (connCode1) StereotypesHelper.setStereotypePropertyValue(sc, sigStereo, "连接器编号_端1", connCode1)
                if (connCode2) StereotypesHelper.setStereotypePropertyValue(sc, sigStereo, "连接器编号_端2", connCode2)
            } catch (ignored) {}

            sigIdToSysmlConn[sigId] = sc
            sigCreated++
            // 前3个Connector输出诊断信息
            if (sigCreated <= 3) {
                def endCnt = sc.getEnd().size()
                def r0 = endCnt > 0 ? sc.getEnd().get(0).getRole()?.getName() : "null"
                def r1 = endCnt > 1 ? sc.getEnd().get(1).getRole()?.getName() : "null"
                def pw0 = endCnt > 0 ? sc.getEnd().get(0).getPartWithPort()?.getName() : "null"
                def pw1 = endCnt > 1 ? sc.getEnd().get(1).getPartWithPort()?.getName() : "null"
                def nce0 = (endCnt > 0 && nceStereo) ? StereotypesHelper.hasStereotype(sc.getEnd().get(0), nceStereo) : false
                def nce1 = (endCnt > 1 && nceStereo) ? StereotypesHelper.hasStereotype(sc.getEnd().get(1), nceStereo) : false
                log("  诊断 Connector[${sigCreated}] '${sigName}': ends=${endCnt}, role0=${r0}(nce=${nce0}), pwp0=${pw0}, role1=${r1}(nce=${nce1}), pwp1=${pw1}")
            }
            if (sigCreated % 500 == 0) log("  信号: ${sigCreated}...")
        } catch (e) {
            sigErrors++
            if (sigErrors <= 3) log("  信号创建失败: ${e.getClass().simpleName}: ${e.message}")
        }
    }
    log("信号: ${sigCreated} 成功, ${sigSkipped} 跳过, ${sigErrors} 失败")

    SessionManager.getInstance().closeSession(project)
    log("===== 模型元素创建完成 =====")

} catch (Exception e) {
    SessionManager.getInstance().cancelSession(project)
    def err = "模型创建出错: ${e.getClass().simpleName}: ${e.message}\n" + e.stackTrace.take(5).collect { "  $it" }.join("\n")
    log(err)
    JOptionPane.showMessageDialog(null, err, "导入失败", JOptionPane.ERROR_MESSAGE)
    return
}

// ================================================================
// SESSION 2: 创建IBD图
// ================================================================
log("===== 开始创建IBD图 =====")
log("可用数据: ${sigIdToSysmlConn.size()} 个模型Connector, ${connIdToPort.size()} 个Port, ${pinIdToPort.size()} 个Pin")

SessionManager.getInstance().createSession(project, "Create EICD IBD Diagrams")

try {
    def mem = ModelElementsManager.getInstance()
    def pem = PresentationElementsManager.getInstance()
    def ibdCreated = 0
    def ibdErrors = 0
    def totalPathsDrawn = 0
    def totalPathsFailed = 0

    // 确定IBD图类型名（不同MagicDraw版本可能不同）
    def IBD_TYPE = "SysML Internal Block Diagram"

    devices.each { dev ->
        def devId = toLong(dev["id"])
        def devPart = deviceIdToPart[devId]
        if (!devPart) return

        def myConns = connsByDevId[devId]
        if (!myConns || myConns.isEmpty()) return

        def devCode = (dev["设备编号"] ?: "").toString().trim()
        def devName = (dev["设备中文名称"] ?: "").toString().trim()

        try {
            // 创建IBD图
            def diagram = mem.createDiagram(IBD_TYPE, ce25a)
            diagram.setName("IBD - ${devCode} ${devName}".trim())
            def dpe = project.getDiagram(diagram)

            // 本设备连接器ID列表
            def myConnIds = myConns.collect { toLong(it["id"]) }
            // 本设备信号连接关系
            def myDevConns = deviceConns[devId] ?: []
            def otherDevIds = myDevConns.collect { it.otherDevId }.unique()

            // -- 画主设备Part --
            def mainH = Math.max(250, myConnIds.size() * 80)
            def mainShape = pem.createShapeElement(devPart, dpe)
            pem.reshapeShapeElement(mainShape, new Rectangle(50, 50, 300, mainH))

            // -- 画主设备连接器Port (直接在Part shape边界上) --
            def myPortShapes = new HashMap()
            myConnIds.each { connId ->
                def connPort = connIdToPort[connId]
                if (connPort) {
                    try { myPortShapes[connId] = pem.createShapeElement(connPort, mainShape) } catch (ignored) {}
                }
            }

            // -- 画主设备针脚Port (嵌套在连接器Port shape内) --
            def myPinShapes = new HashMap()
            myConnIds.each { connId ->
                def cPins = pinsByConnId[connId]
                if (!cPins) return
                def parentShape = myPortShapes[connId]
                if (!parentShape) return
                cPins.each { pinRec ->
                    def pinId = toLong(pinRec["id"])
                    def pinPort = pinIdToPort[pinId]
                    if (pinPort) {
                        try { myPinShapes[pinId] = pem.createShapeElement(pinPort, parentShape) } catch (ignored) {}
                    }
                }
            }

            // -- 画关联设备 (右侧纵向排列) --
            def otherPartShapes = new HashMap()     // otherDevId → part shape
            def otherPortShapes = new HashMap()     // connId → port shape
            def otherPinShapes  = new HashMap()     // pinId → pin shape
            def yOff = 50

            otherDevIds.each { otherDevId ->
                def otherPart = deviceIdToPart[otherDevId]
                if (!otherPart) return

                def links = myDevConns.findAll { it.otherDevId == otherDevId }
                def otherConnIdSet = links.collect { it.otherConnId }.findAll { it != null }.unique()

                def otherH = Math.max(150, otherConnIdSet.size() * 80)

                try {
                    def otherShape = pem.createShapeElement(otherPart, dpe)
                    pem.reshapeShapeElement(otherShape, new Rectangle(550, yOff, 300, otherH))
                    yOff += otherH + 30
                    otherPartShapes[otherDevId] = otherShape

                    // 关联设备的连接器Port
                    otherConnIdSet.each { connId ->
                        def connPort = connIdToPort[connId]
                        if (connPort) {
                            try { otherPortShapes[connId] = pem.createShapeElement(connPort, otherShape) } catch (ignored) {}
                        }
                    }

                    // 关联设备的针脚Port
                    def otherPinIdSet = links.collect { it.otherPinId }.findAll { it != null }.unique()
                    otherPinIdSet.each { pinId ->
                        def pinPort = pinIdToPort[pinId]
                        def pinRec = pinById[pinId]
                        if (pinPort && pinRec) {
                            def cid = toLong(pinRec["connector_id"])
                            def parentShape = otherPortShapes[cid]
                            if (parentShape) {
                                try { otherPinShapes[pinId] = pem.createShapeElement(pinPort, parentShape) } catch (ignored) {}
                            }
                        }
                    }
                } catch (ignored) {}
            }

            // -- 画信号连线 (connector port层级优先，fallback到part层级) --
            def pathsThisDiag = 0
            myDevConns.each { link ->
                def sysmlConn = sigIdToSysmlConn[link.sigId]
                if (!sysmlConn) return

                def drawn = false

                // Level 1: 在connector port层级画线（与模型Connector的ConnectorEnd一致）
                if (!drawn && link.myConnId && link.otherConnId) {
                    def srcShape = myPortShapes[link.myConnId]
                    def tgtShape = otherPortShapes[link.otherConnId]
                    if (srcShape && tgtShape) {
                        try {
                            pem.createPathElement(sysmlConn, srcShape, tgtShape)
                            drawn = true
                        } catch (ignored) {}
                    }
                }

                // Level 2: 尝试在pin port层级画线（显示层面，即使模型Connector连的是connector port）
                if (!drawn) {
                    def srcShape = myPinShapes[link.myPinId]
                    def tgtShape = otherPinShapes[link.otherPinId]
                    if (srcShape && tgtShape) {
                        try {
                            pem.createPathElement(sysmlConn, srcShape, tgtShape)
                            drawn = true
                        } catch (ignored) {}
                    }
                }

                // Level 3: 尝试在Part层级画线
                if (!drawn) {
                    def tgtPartShape = otherPartShapes[link.otherDevId]
                    if (mainShape && tgtPartShape) {
                        try {
                            pem.createPathElement(sysmlConn, mainShape, tgtPartShape)
                            drawn = true
                        } catch (ignored) {}
                    }
                }

                if (drawn) pathsThisDiag++
                else totalPathsFailed++
            }
            totalPathsDrawn += pathsThisDiag

            ibdCreated++
            if (ibdCreated % 20 == 0) log("  IBD图: ${ibdCreated}... (连线成功: ${totalPathsDrawn})")

        } catch (Exception e) {
            ibdErrors++
            if (ibdErrors <= 3) log("  IBD失败: ${devCode} - ${e.getClass().simpleName}: ${e.message}")
        }
    }

    SessionManager.getInstance().closeSession(project)
    log("IBD图: ${ibdCreated} 成功, ${ibdErrors} 失败")
    log("Connector连线: ${totalPathsDrawn} 成功, ${totalPathsFailed} 失败")

    // ===== 最终汇总 =====
    def summary = "EICD全量导入+IBD图 完成!\n\n" +
        "模型元素:\n" +
        "  CE25A飞行器: ${deviceIdToPart.size()} 个设备Part\n" +
        "  设备Block: ${deviceIdToBlock.size()}\n" +
        "  连接器Port: ${connIdToPort.size()}\n" +
        "  针脚Port: ${pinIdToPort.size()}\n" +
        "  信号Connector: ${sigIdToSysmlConn.size()}\n\n" +
        "IBD图: ${ibdCreated} 张\n" +
        "  Connector连线: ${totalPathsDrawn} 成功, ${totalPathsFailed} 失败\n\n" +
        "位置: EICD设备 > CE25A飞行器 下的IBD图"
    log(summary)
    JOptionPane.showMessageDialog(null, summary, "EICD导入完成", JOptionPane.INFORMATION_MESSAGE)

} catch (Exception e) {
    SessionManager.getInstance().cancelSession(project)
    def err = "IBD图创建出错: ${e.getClass().simpleName}: ${e.message}\n" + e.stackTrace.take(5).collect { "  $it" }.join("\n")
    log(err)
    JOptionPane.showMessageDialog(null, "模型元素已创建成功!\n\nIBD图创建出错:\n${e.message}", "IBD创建失败", JOptionPane.WARNING_MESSAGE)
}
