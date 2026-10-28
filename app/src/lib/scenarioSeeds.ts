/** The seeded scenario registry, mirrored from the Rust `SCENARIO_SEEDS`
 * (app/core/src/db/scenarios.rs) into the TS layer: the enrichment
 * prompt needs the full answer-key list in one string, and the parse
 * side drops any key the model invents that is not in this list.
 * Keep in sync with the Rust seeds (seed_taxonomy_is_well_formed
 * guards the Rust side; the mirroring test guards this side). */
export const SCENARIO_SEED_KEYS: readonly string[] = [
  "dining.cafe", // Café / Coffee shop / 咖啡店
  "dining.restaurant", // Restaurant / 餐厅
  "dining.fast-food", // Fast food / 快餐店
  "dining.bar", // Bar / Pub / 酒吧
  "dining.bakery", // Bakery / 面包店
  "travel.airport", // Airport / 机场
  "travel.flight", // On the plane / 飞机上
  "travel.hotel", // Hotel / 酒店
  "travel.customs", // Customs & immigration / 海关入境
  "travel.car-rental", // Car rental / 租车
  "travel.asking-directions", // Asking directions / 问路
  "transport.rideshare-taxi", // Rideshare / Taxi / 网约车 / 出租车
  "transport.public-transit", // Public transit / 公共交通
  "transport.gas-station", // Gas station / 加油站
  "transport.car-repair", // Car repair / 修车
  "shopping.supermarket", // Supermarket / 超市
  "shopping.clothing", // Clothing store / 服装店
  "shopping.pharmacy", // Pharmacy / 药店
  "shopping.returns-exchanges", // Returns & exchanges / 退换货
  "shopping.farmers-market", // Farmers market / 农贸市场
  "services.bank", // Bank / 银行
  "services.post-office", // Post office / 邮局
  "services.haircut", // Haircut / 理发
  "services.phone-repair", // Phone repair / 手机维修
  "services.dry-cleaning", // Dry cleaning / 干洗店
  "health.doctor", // Doctor visit / 看医生
  "health.dentist", // Dentist / 牙医
  "health.pharmacy-consult", // Pharmacy consult / 药房咨询
  "health.emergency-room", // Emergency room / 急诊
  "health.vet", // Vet / 兽医
  "housing.apartment-viewing", // Apartment viewing / 看房
  "housing.landlord-repairs", // Landlord repairs / 报修
  "housing.utilities-setup", // Utilities setup / 开通水电网
  "housing.moving", // Moving / 搬家
  "work.job-interview", // Job interview / 求职面试
  "work.meetings", // Meetings / 会议
  "work.office-small-talk", // Office small talk / 办公室闲聊
  "work.phone-calls", // Phone calls / 工作电话
  "work.presentations", // Presentations / 演讲展示
  "social.introductions", // Introductions / 初次见面
  "social.party", // Party / 聚会
  "social.neighbors", // Neighbors / 邻居
  "social.invitations", // Invitations / 邀请与赴约
  "social.giving-opinions", // Giving opinions / 表达观点
  "emergency.police", // Police / 报警
  "emergency.lost-items", // Lost items / 遗失物品
  "emergency.accidents-insurance", // Accidents & insurance / 事故与保险
  "meta.repair", // Repair toolkit / 救场工具箱
];

export const SCENARIO_KEY_SET: ReadonlySet<string> = new Set(SCENARIO_SEED_KEYS);
