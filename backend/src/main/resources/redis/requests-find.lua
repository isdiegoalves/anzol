-- Uma mensagem (ARGV[1]) e o seq dela: {JSON, seq}; {} se a hash não a tem.
backfill()
local json = redis.call('HGET', messages, ARGV[1])
if not json then return {} end
return {json, score(tonumber(redis.call('ZSCORE', index, ARGV[1]) or legacyScore(json)))}
