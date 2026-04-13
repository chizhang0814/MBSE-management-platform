检查数据库中的数据一致性问题。

检查项目（默认 CE-25A X号机，project_id=45）：

1. **审批已结束但状态仍为Pending的实体**
   - 设备：status=Pending 但无 pending 的 approval_requests
   - 连接器：同上
   - 针孔：同上
   - 信号：同上

2. **端点都已确认但信号仍在completion阶段**
   - approval_requests.current_phase='completion' 且所有 signal_endpoints.confirmed=1 且 pin_id 非空

3. **completion接收人在信号端点中已无设备**
   - pending completion 项的接收人不是当前信号任何端点的设备负责人

4. **虚拟字段泄漏到审批payload**
   - 检查 approval_requests.payload 中是否包含 sub_approval_request_ids, pending_item_type, has_pending_sub 等虚拟字段

5. **信号分组内连接类型/协议标识为空**
   - 已分组的信号连接类型或协议标识为NULL

对每个发现的问题：报告数量和示例，但**不要自动修复**，等用户确认。
