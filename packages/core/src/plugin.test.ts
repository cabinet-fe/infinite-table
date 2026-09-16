import { describe, expect, it } from 'vitest';

import { ListTable } from './list-table';
import type { TablePlugin } from './plugin';
import { StubHost } from './testing/stub-host';

function recordPlugin(name: string, log: string[]): TablePlugin {
  return {
    name,
    mount(table) {
      log.push(`mount:${name}:${table instanceof ListTable}`);
    },
    unmount() {
      log.push(`unmount:${name}`);
    },
  };
}

function createTable(plugins?: readonly TablePlugin[]) {
  const host = new StubHost();
  const table = new ListTable({
    width: 800,
    height: 600,
    columns: [{ field: 'name' }],
    records: [{ name: 'a' }],
    plugins,
    host,
  });
  return { host, table };
}

describe('插件统一注册路径', () => {
  it('构造传入插件即挂载生效（注册即通过）', () => {
    const log: string[] = [];
    const { table } = createTable([recordPlugin('a', log), recordPlugin('b', log)]);
    expect(log).toEqual(['mount:a:true', 'mount:b:true']);
    table.destroy();
  });

  it('use() 运行时注册即挂载', () => {
    const log: string[] = [];
    const { table } = createTable();
    expect(log).toEqual([]);
    table.use(recordPlugin('c', log));
    expect(log).toEqual(['mount:c:true']);
    table.destroy();
  });

  it('销毁时逆序卸载，重复 destroy 幂等', () => {
    const log: string[] = [];
    const { table } = createTable([recordPlugin('a', log), recordPlugin('b', log)]);
    log.length = 0;
    table.destroy();
    table.destroy();
    expect(log).toEqual(['unmount:b', 'unmount:a']);
  });
});
