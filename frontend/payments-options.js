export const PAYMENT_OPTIONS=Object.freeze([
 Object.freeze({id:'single',costCents:500,spots:1,multiplier:1,method:'enter'}),
 Object.freeze({id:'four',costCents:2000,spots:4,multiplier:1,method:'enterFour'}),
 Object.freeze({id:'bundle',costCents:5000,spots:10,multiplier:1.05,method:'enter'}),
]);
export const paymentOption=value=>PAYMENT_OPTIONS.find(o=>o.costCents===value||o.id===value);
