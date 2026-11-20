// QuickNode Logs dataset filter for the verified V1, V2 and daily V3 deployments.
// Keep earlier addresses so old claims and cancellation events remain indexed.
function main(stream) {
  const addresses = [
    "0x0e45cf9200c27af84ba175a8f6723ffd8dd8b083",
    "0x869645d675ce22527ea37112b2c8e640f4cd2919",
    "0xe3afdbf235e902de46418535f25ca4e23f9fdf92",
  ];
  const logs=stream.data.flat(Infinity).filter(log=>typeof log?.address==='string'&&addresses.includes(log.address.toLowerCase()));
  return logs.length?{schemaVersion:2,chainId:5042002,metadata:stream.metadata??{},logs}:null;
}
