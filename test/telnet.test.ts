import { describe, it, expect } from 'vitest';
import { newTelnetState, processTelnet, escapeTelnetOutput } from '../src/main/services/telnet';

const IAC = 255, WILL = 251, WONT = 252, DO = 253, DONT = 254, SB = 250, SE = 240, NOP = 241;
const ECHO = 1, SGA = 3, TTYPE = 24, NAWS = 31;

describe('processTelnet', () => {
  it('passes plain data through unchanged', () => {
    const r = processTelnet(newTelnetState(), Buffer.from('hello'));
    expect(r.out.toString()).toBe('hello');
    expect(r.reply.length).toBe(0);
  });
  it('agrees to server WILL ECHO / WILL SGA, refuses other WILLs', () => {
    const r = processTelnet(newTelnetState(), Buffer.from([IAC, WILL, ECHO, IAC, WILL, SGA, IAC, WILL, TTYPE]));
    expect([...r.reply]).toEqual([IAC, DO, ECHO, IAC, DO, SGA, IAC, DONT, TTYPE]);
    expect(r.out.length).toBe(0);
  });
  it('answers DO SGA with WILL and other DOs with WONT', () => {
    const r = processTelnet(newTelnetState(), Buffer.from([IAC, DO, SGA, IAC, DO, NAWS]));
    expect([...r.reply]).toEqual([IAC, WILL, SGA, IAC, WONT, NAWS]);
  });
  it('unescapes IAC IAC to a literal 0xFF and strips commands from the data', () => {
    const r = processTelnet(newTelnetState(), Buffer.from([0x41, IAC, IAC, 0x42, IAC, NOP, 0x43]));
    expect([...r.out]).toEqual([0x41, 0xff, 0x42, 0x43]);
  });
  it('skips subnegotiation blocks (SB … IAC SE)', () => {
    const r = processTelnet(newTelnetState(), Buffer.from([0x41, IAC, SB, TTYPE, 0, 1, 2, IAC, SE, 0x42]));
    expect([...r.out]).toEqual([0x41, 0x42]);
  });
  it('handles an IAC sequence split across chunks', () => {
    const s = newTelnetState();
    const r1 = processTelnet(s, Buffer.from([0x41, IAC]));
    const r2 = processTelnet(s, Buffer.from([WILL, ECHO]));
    expect([...r1.out]).toEqual([0x41]);
    expect([...r2.reply]).toEqual([IAC, DO, ECHO]);
  });
});

describe('escapeTelnetOutput', () => {
  it('doubles 0xFF in outbound data', () => {
    expect([...escapeTelnetOutput(Buffer.from([0x41, 0xff, 0x42]))]).toEqual([0x41, 0xff, 0xff, 0x42]);
  });
  it('leaves IAC-free data untouched', () => {
    expect([...escapeTelnetOutput(Buffer.from('ok'))]).toEqual([0x6f, 0x6b]);
  });
});
