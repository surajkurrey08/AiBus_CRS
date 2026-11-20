import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
const collection = read("postman.runner.v1.json"), original = read("postman.v1.json");
const all = collection.item.flatMap(folder => folder.item);
const flow = collection.item[1].item;
const store = () => new Map(read("postman.sandbox.environment.json").values.map(v => [v.key, v.value]));
class Skip extends Error {}
function run(item, listen, values, data, status = 200) {
  let stopped = false;
  const equal = value => expected => assert.equal(value, expected);
  const pm = {
    environment: { get: key => values.get(key), set: (key,value) => values.set(key,value), unset: key => values.delete(key) },
    variables: { replaceIn: () => "11111111-2222-3333-4444-555555555555" },
    info: { requestName: item.name },
    execution: { setNextRequest: value => { if (value === null) stopped = true; }, skipRequest: () => { throw new Skip(); } },
    response: { code: status, json: () => ({ data }) },
    test: (_name, fn) => fn(),
    expect: value => ({ to: { equal: equal(value), include: expected => assert.ok(value.includes(expected)) }, not: { to: { equal: expected => assert.notEqual(value,expected) } } }),
  };
  const script = item.event.find(event => event.listen === listen).script.exec.join("\n");
  vm.runInNewContext(script, { pm, Date, console: { warn() {} } });
  return stopped;
}
test("all original API operations are represented and all scripts compile", () => {
  const key = item => item.request.method + " " + item.request.url.split("?")[0];
  const actual = new Set(all.map(key));
  for (const item of original.item) assert.ok(actual.has(key(item)), item.name);
  for (const item of all) for (const event of item.event || []) new vm.Script(event.script.exec.join("\n"));
  for (const file of ["postman.live.environment.json", "postman.sandbox.environment.json"])
    for (const row of read(file).values.filter(v => ["apiCredential","accessToken"].includes(v.key))) assert.equal(row.value, "");
  assert.equal(read("postman.external-sandbox.environment.json").values.find(v => v.key === "baseUrl").value, "https://partner.bookmybus.pro/api/v1/public");
});
test("token refresh preserves request identities and existing booking references", () => {
  const values=store(); values.set("apiCredential","fixture-only-credential");
  run(flow[0],"test",values,{accessToken:"fixture-only-token",expiresIn:300});
  const key=values.get("holdKey"), reference=values.get("partnerReference");
  values.set("bookingId","booking_fixture_existing");
  run(flow[0],"test",values,{accessToken:"new-fixture-only-token",expiresIn:300});
  assert.equal(values.get("holdKey"),key); assert.equal(values.get("partnerReference"),reference);
  assert.equal(values.get("bookingId"),"booking_fixture_existing");
});
test("city, trip, seat, hold and quote responses populate subsequent requests", () => {
  const values=store();
  run(flow[0],"test",values,{accessToken:"fixture-only-token",expiresIn:300});
  run(flow[1],"test",values,{environment:"sandbox",liveTicketIssuance:false});
  run(flow[2],"test",values,[{id:"city_pune_fixture",name:"Pune"},{id:"city_mumbai_fixture",name:"Mumbai"}]);
  run(flow[3],"test",values,[{id:"trip_fixture_available",availableSeats:1}]);
  run(flow[5],"test",values,{seats:[{number:"L1",state:"booked"},{number:"L2",state:"available"}]});
  run(flow[9],"test",values,{id:"hold_fixture",expiresAt:"2030-01-01"},201);
  run(flow[10],"test",values,{id:"quote_fixture",holdId:"hold_fixture",expiresAt:"2030-01-01"});
  assert.equal(values.get("fromCityId"),"city_pune_fixture"); assert.equal(values.get("seatNumber"),"L2");
  assert.equal(values.get("holdId"),"hold_fixture"); assert.equal(values.get("quoteId"),"quote_fixture");
});
test("production hosts and writes without explicit sandbox opt-in are blocked", () => {
  const values=store(); values.set("apiCredential","fixture-only-credential");
  values.set("baseUrl","https://api.bookmybus.pro/api/v1/public");
  assert.throws(()=>run(flow[0],"prerequest",values),Skip);
  values.set("baseUrl","http://127.0.0.1:4001/api/v1/public");
  run(flow[0],"test",values,{accessToken:"fixture-only-token",expiresIn:300});
  run(flow[1],"test",values,{environment:"sandbox",liveTicketIssuance:false});
  values.set("tripId","trip_fixture"); values.set("seatNumber","L1");
  assert.throws(()=>run(flow[8],"prerequest",values),Skip);
  values.set("allowSandboxWrites","true");
  assert.equal(run(flow[8],"prerequest",values),false);
});
test("all idempotent writes use distinct header variables and test payment precedes cancellation", () => {
  const keys=[];
  for(const name of ["10 Hold selected seat","12 Create pending booking","13 Create Razorpay Test Mode order","14 Verify test checkout response — enter provider values first","18 Request cancellation — operator review required"]){
    const item=flow.find(r=>r.name===name), header=item.request.header.find(h=>h.key==='Idempotency-Key');
    assert.ok(header); assert.ok(!item.request.url.includes('Idempotency-Key')); keys.push(header.value);
  }
  assert.equal(new Set(keys).size,5);
  assert.ok(flow.findIndex(r=>r.name.startsWith('17 ')) < flow.findIndex(r=>r.name.startsWith('18 ')));
  const quote=JSON.parse(flow.find(r=>r.name.startsWith('09 ')).request.body.raw);
  assert.equal(quote.holdId,undefined);
});
