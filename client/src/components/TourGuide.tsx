import { useEffect } from 'react';
import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

interface TourGuideProps {
  user: { id: number; username: string; role: string } | null;
}

type ProjectRole = '总体人员' | 'EWIS管理员' | '设备管理员' | '一级包长' | '二级包长' | '只读' | '';

const ROLE_PRIORITY: ProjectRole[] = ['总体人员', 'EWIS管理员', '设备管理员', '一级包长', '二级包长', '只读'];

function getPrimaryRole(roles: string[]): ProjectRole {
  for (const r of ROLE_PRIORITY) {
    if (roles.includes(r)) return r;
  }
  return '';
}

export default function TourGuide({ user }: TourGuideProps) {
  useEffect(() => {
    if (!user) return;
    if (localStorage.getItem('tour_dismissed') === '1') return;
    if (sessionStorage.getItem('tour_pending') !== '1') return;
    sessionStorage.removeItem('tour_pending');

    const token = localStorage.getItem('token');

    fetch('/api/auth/profile', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.ok ? res.json() : { permissions: [] })
      .then(data => {
        const roles: string[] = (data.permissions || []).map((p: { project_role: string }) => p.project_role);
        const primaryRole = getPrimaryRole(roles);
        const canManage = primaryRole === '总体人员' || primaryRole === '设备管理员';

        // 步骤 1：筛选栏
        const filterDesc = (() => {
          const base = '这里可以切换设备列表的显示范围：\n• 全部：显示该项目下所有设备\n• 我的：只显示您负责的设备';
          if (primaryRole === '总体人员') return base + '\n• 待我审批：等待您审批通过的变更申请';
          if (primaryRole === '设备管理员') return base + '\n• 待我完善：审批流程中需要您补充信息的设备';
          return base;
        })();

        // 步骤 3：编辑设备
        const editDesc = primaryRole === '总体人员'
          ? '点击编辑可修改设备信息，您也可以在此审批他人提交的变更。'
          : '点击编辑可修改您负责的设备信息，保存后自动提交审批流程。';

        // 步骤 5：通知中心
        const notifDesc = primaryRole === '总体人员'
          ? '变更审批请求和权限申请会在这里提醒，红点表示有待处理事项，请及时审批。'
          : primaryRole === '设备管理员'
          ? '当您提交的变更需要补充信息时，会在这里收到通知。'
          : '系统消息和通知在这里显示，红点表示有未读消息。';

        const steps: DriveStep[] = [
          {
            element: '#tour-filter-tabs',
            popover: {
              title: '设备筛选',
              description: filterDesc,
            },
          },
          {
            element: '#tour-device-expand',
            popover: {
              title: '展开设备详情',
              description: '点击每行左侧的 ▶ 按钮，可展开查看该设备下的连接器和针孔详情。双击行也可展开。',
            },
          },
          ...(canManage ? [
            {
              element: '#tour-device-edit',
              popover: {
                title: '编辑设备',
                description: editDesc,
              },
            },
            {
              element: '#tour-add-device',
              popover: {
                title: '添加设备',
                description: '点击此按钮可新增设备，填写设备编号、名称、负责人等基本信息后提交。',
              },
            },
          ] : []),
          {
            element: '#tour-nav-notifications',
            popover: {
              title: '通知中心',
              description: notifDesc,
            },
          },
          {
            element: '#tour-nav-profile',
            popover: {
              title: '个人设置',
              description: '点击这里可以申请加入项目、查看已有权限。',
            },
          },
        ];

        // 最后一步点"以后不再出现"时永久关闭
        const lastStep = steps[steps.length - 1];
        lastStep.popover!.onNextClick = () => {
          localStorage.setItem('tour_dismissed', '1');
          driverObj.destroy();
        };

        const driverObj = driver({
          showProgress: true,
          progressText: '{{current}} / {{total}}',
          nextBtnText: '下一步 →',
          prevBtnText: '← 上一步',
          doneBtnText: '以后不再出现',
          allowClose: true,
          steps,
        });

        const timer = setTimeout(() => driverObj.drive(), 800);
        return () => clearTimeout(timer);
      })
      .catch(() => {/* 静默失败，不影响正常使用 */});
  }, [user]);

  return null;
}
