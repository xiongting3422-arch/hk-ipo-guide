(function (global) {
  'use strict';
  global.IPO_BREAK_RISK_SIGNALS = [
    {
      index: 1,
      name: '暗盘跌幅逾5%',
      level: '重度',
      color_code: 'deep_red',
      popover_impact:
        '暗盘是二级市场对发行价的即时公投，跌幅超5%代表机构已明确否决定价。首日开盘散户集体止损踩踏，无抄底买盘承接，破发概率接近百分之百。',
    },
    {
      index: 2,
      name: '认购倍数低于30x',
      level: '重度',
      color_code: 'deep_red',
      popover_impact:
        '正常港股IPO须百倍以上超额才能支撑发行价。30倍以下代表机构询价已拒绝为当前定价兜底，乙组套利资金严重不足，首日卖压无人消化。',
    },
    {
      index: 3,
      name: '绿鞋机制缺失',
      level: '重度',
      color_code: 'deep_red',
      popover_impact:
        '绿鞋是保荐人以超额募集资金回购股票的唯一合规托价工具。一旦缺失，首日面临任何抛压时保荐人无法合规介入，价格失去最后一道缓冲直接自由落体。',
    },
    {
      index: 4,
      name: '乙组全中且申请人稀少',
      level: '重度',
      color_code: 'deep_red',
      popover_impact:
        '乙组有效申请人不足五千人且全额中签，少数大户持有高度集中的一致成本筹码。暗盘一出现套利窗口，大户集体砸盘，甲组散户独自承接所有抛压。',
    },
    {
      index: 5,
      name: '恶性强制回拨触发',
      level: '重度',
      color_code: 'deep_red',
      popover_impact:
        '超高超额触发回拨，大量筹码被强制压入甲组散户手中。散户成本均一、信息滞后，无法在暗盘提前出货，被迫在首日开盘后集中形成系统性卖压来源。',
    },
    {
      index: 6,
      name: '老股东高比例IPO套现',
      level: '重度',
      color_code: 'deep_red',
      popover_impact:
        '原始股东在IPO窗口大量减持是内部人对公司前景最直接的否定投票。套现比例超三成意味着一级市场本质上是大股东的退出通道，而非企业融资扩张。',
    },
    {
      index: 7,
      name: '估值严重偏离行业PE',
      level: '中度',
      color_code: 'mid_red',
      popover_impact:
        '发行PE远超同赛道港股可比公司均值，定价隐含过于乐观的增长预期。投资者在二级市场发现估值锚缺失后立即开始修正，溢价越大修正幅度越深越快。',
    },
    {
      index: 8,
      name: 'A/H折价率过低',
      level: '中度',
      color_code: 'mid_red',
      popover_impact:
        'H股溢价高于A股时，跨市场套利机制自动激活，H股面临来自A股持有人的持续性做空套利压力。折价率低于5%或倒挂是H股系统性下行修正的临界触发点。',
    },
    {
      index: 9,
      name: '基石投资者含金量低',
      level: '中度',
      color_code: 'mid_red',
      popover_impact:
        '基石投资者为关联方、空壳公司或非金融机构时，六个月锁仓到期后将集体出货。低质量基石是有组织减持的前置埋雷，代表真正的长期机构投资者完全缺位。',
    },
    {
      index: 10,
      name: '保荐人护盘记录差',
      level: '中度',
      color_code: 'mid_red',
      popover_impact:
        '保荐人在历史IPO项目中多次出现破发却未动用绿鞋托底，代表其将护盘义务视为可放弃选项。本次IPO面临破发压力时，大概率再次选择弃守发行价。',
    },
    {
      index: 11,
      name: '财务持续失血',
      level: '中度',
      color_code: 'mid_red',
      popover_impact:
        '连续三年经营亏损且亏损扩大，IPO定价完全依赖概念叙事而非业绩支撑。二级市场无法用PE锚定估值，任何利空消息都将引发估值框架崩塌式下跌。',
    },
    {
      index: 12,
      name: '高杠杆资产负债结构',
      level: '中度',
      color_code: 'mid_red',
      popover_impact:
        '资产负债率超七成时，募集资金优先偿债而非扩张，定价PE隐含的成长性无法兑现。利率上行或营收承压时市场对偿债能力的担忧将引发非理性杀估值。',
    },
    {
      index: 13,
      name: '新股密集撞期',
      level: '轻度',
      color_code: 'light_red',
      popover_impact:
        '同期三只以上IPO同步发行，打新资金被迫分散，各标的超额认购倍数同步下行。边缘标的中签率异常升高但缺乏真实需求，成为破发压力集中释放的薄弱点。',
    },
    {
      index: 14,
      name: '公开发售浮筹极小',
      level: '轻度',
      color_code: 'light_red',
      popover_impact:
        '公开发售规模极小时，少量资金即可堆出高超额数字制造热门假象。真实流通盘占比低意味着上市后任何卖盘都对价格造成不成比例的冲击，破发时跌幅更深。',
    },
    {
      index: 15,
      name: '保荐费率异常偏高',
      level: '轻度',
      color_code: 'light_red',
      popover_impact:
        '承销费占募资总额超5%或存在异常附加费时，保荐人已通过发行环节完成利润收割，对IPO后股价表现的激励大幅弱化，护盘意愿在利益脱钩后趋近于零。',
    },
    {
      index: 16,
      name: '赛道机构覆盖缺失',
      level: '轻度',
      color_code: 'light_red',
      popover_impact:
        '上市前无任何主流买方机构发布研究报告，代表赛道缺乏机构持仓定价基准。首日开盘后无机构提供买盘支撑，散户单向恐慌性卖出将引发价格真空式下探。',
    },
    {
      index: 17,
      name: '发行价锁定区间顶端',
      level: '轻度',
      color_code: 'light_red',
      popover_impact:
        '将发行价定于询价区间上限代表保荐人压榨最后一分溢价，不留任何安全边际。上市后一旦二级市场与发行价相比无利可图，边际买盘立刻消失形成破发压力。',
    },
    {
      index: 18,
      name: '大盘暨板块情绪失血',
      level: '轻度',
      color_code: 'light_red',
      popover_impact:
        '恒指跌幅超3%或所属赛道持续下行时，新股无法享受市场情绪托举，发行价隐含的溢价在负Beta环境中被系统性吸收，跌破发行价成为大概率事件。',
    },
  ];
})(typeof window !== 'undefined' ? window : global);
