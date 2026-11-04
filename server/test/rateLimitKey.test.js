// Architect review of B1.4: IP-keyed rate limits count IPv6 per /56 prefix, so a client
// cannot rotate addresses inside its own prefix to escape the limit.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { UNKNOWN_IP_KEY, rateLimitKeyForIp } from '../utils/security.js';

describe('rateLimitKeyForIp', () => {
  const cases = [
    ['IPv4', '203.0.113.7', 'ip4:203.0.113.7'],
    ['IPv4 with surrounding spaces', ' 198.51.100.1 ', 'ip4:198.51.100.1'],
    ['IPv4-mapped IPv6', '::ffff:1.2.3.4', 'ip4:1.2.3.4'],
    ['IPv4-mapped IPv6, upper case', '::FFFF:1.2.3.4', 'ip4:1.2.3.4'],
    ['IPv4-mapped IPv6, full form', '0:0:0:0:0:ffff:1.2.3.4', 'ip4:1.2.3.4'],
    ['IPv4-mapped IPv6, hex form', '::ffff:0102:0304', 'ip4:1.2.3.4'],
    ['compressed IPv6', '2001:db8::1', 'ip6:2001:db8::/56'],
    ['loopback', '::1', 'ip6:::/56'],
    ['unspecified', '::', 'ip6:::/56'],
    ['full IPv6 with leading zeros', '2001:0db8:abcd:12ff:0000:0000:0000:0001', 'ip6:2001:db8:abcd:1200::/56'],
    ['upper case', '2001:DB8:ABCD:12AB::9', 'ip6:2001:db8:abcd:1200::/56'],
    ['zone id dropped', 'fe80::1%eth0', 'ip6:fe80::/56'],
    ['zone id and upper case', 'FE80::ABCD%en0', 'ip6:fe80::/56'],
    ['brackets', '[2001:db8::1]', 'ip6:2001:db8::/56'],
    ['embedded IPv4 that is not mapped', '64:ff9b::1.2.3.4', 'ip6:64:ff9b::/56'],
    ['no zero run to compress', '2001:db8:aaaa:bbcc:1:2:3:4', 'ip6:2001:db8:aaaa:bb00::/56']
  ];
  for (const [name, ip, key] of cases) {
    test(`${name}: ${ip}`, () => assert.equal(rateLimitKeyForIp(ip), key));
  }

  test('empty or unparsable values share one fixed key, so they cannot escape limiting', () => {
    const garbage = [
      undefined, null, 42, '', '   ', 'garbage', 'unknown', '1.2.3', '1.2.3.4.5', '256.1.1.1', '01.2.3.4',
      '2001:db8::1::2', '2001:db8:0:0:0:0:0:0:1', '2001:db8:::1', '12345::1', 'g::1', '::ffff:999.1.1.1', '%eth0', '[]'
    ];
    for (const value of garbage) assert.equal(rateLimitKeyForIp(value), UNKNOWN_IP_KEY, JSON.stringify(value));
    assert.equal(UNKNOWN_IP_KEY, 'ip:unknown');
  });

  test('two addresses in the same /56 share a key; different /56 prefixes do not', () => {
    const sameKey = ['2001:db8:1:2::a', '2001:db8:1:3::b', '2001:db8:1:ff:1:2:3:4', '2001:DB8:1:0::1%wlan0'];
    for (const ip of sameKey) assert.equal(rateLimitKeyForIp(ip), 'ip6:2001:db8:1::/56', ip);
    // One bit past the /56 boundary (the low byte of the 4th group) changes nothing;
    // the high byte of the 4th group, or any earlier group, does
    assert.notEqual(rateLimitKeyForIp('2001:db8:1:100::a'), rateLimitKeyForIp('2001:db8:1:2::a'));
    assert.notEqual(rateLimitKeyForIp('2001:db8:2:2::a'), rateLimitKeyForIp('2001:db8:1:2::a'));
    assert.equal(rateLimitKeyForIp('2001:db8:1:1ff::a'), 'ip6:2001:db8:1:100::/56');
  });

  test('IPv4 addresses are never grouped', () => {
    assert.notEqual(rateLimitKeyForIp('203.0.113.1'), rateLimitKeyForIp('203.0.113.2'));
    assert.equal(rateLimitKeyForIp('::ffff:203.0.113.1'), rateLimitKeyForIp('203.0.113.1'));
  });
});
