import sys
p = 'server/room.ts'
s = open(p, encoding='utf-8').read()
old = """      waitingNext: false,
      yourTurn: false,
      canRespond: false,"""
new = """      waitingNext: false,
      nextReady: room.nextReady ?? [],
      trusted: room.trusted ?? [false, false, false, false],
      yourTurn: false,
      canRespond: false,"""
assert old in s, '未匹配 buildView 初始对象'
s = s.replace(old, new)
open(p, 'w', encoding='utf-8').write(s)
print('buildView 初始对象已加 nextReady/trusted')
