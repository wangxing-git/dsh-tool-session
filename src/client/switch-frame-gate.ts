/**
 * 切换意图帧闸门：按 host 端单调递增的 revision 只放行一次。
 *
 * 与 host 端「投递水位」互补的第二道防线：host 保证同一意图最多补投一次，
 * 本闸门再挡掉同一意图经多条连接重复到达（重连瞬间旧流缓冲帧 + 新流补投帧）
 * 造成的重复导航——重复 openSession 虽幂等，但会让 UI 无谓回跳。
 *
 * 兼容性：revision 缺失（旧版 host 帧）时放行，保持向后兼容；revision 存在但
 * 非法（非安全正整数，例如坏帧/伪造帧）时丢弃，避免污染水位后误判后续帧。
 *
 * 依赖全部为纯数据，不触碰 DSH Web 宿主运行时，故可脱离浏览器单测。
 *
 * @module dsh-tool-session/client/switch-frame-gate
 */

/** 按 revision 单调去重的意图帧闸门（实例状态即「已放行的最大序号」）。 */
export class SwitchFrameGate {
  /** 已放行的最大 revision；0 表示尚未放行任何带序号的帧。 */
  private last = 0

  /**
   * 判定一帧意图是否应落地。
   * @param revision - host 端埋入的意图序号；undefined 表示旧版 host 帧。
   * @returns true 表示首次见到（应消费），false 表示重复/陈旧/非法（应丢弃）。
   */
  accept(revision: number | undefined): boolean {
    if (revision === undefined) return true
    if (!Number.isSafeInteger(revision) || revision <= 0) return false
    if (revision <= this.last) return false
    this.last = revision
    return true
  }
}
