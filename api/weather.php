<?php
/**
 * Прокси погоды Сокол-М для статического хостинга (без Flask).
 * Читает data/weather_config.json и ходит на sokolmeteo.com.
 *
 * URL: /RubinFields/api/weather.php  или  /api/weather.php
 */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

$root = dirname(__DIR__);
$configPath = $root . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'weather_config.json';

function fail($code, $message) {
  http_response_code($code);
  echo json_encode(['error' => $message, 'source' => 'sokol'], JSON_UNESCAPED_UNICODE);
  exit;
}

if (!is_file($configPath)) {
  fail(500, 'Нет data/weather_config.json');
}

$cfgAll = json_decode(file_get_contents($configPath), true);
$cfg = $cfgAll['sokol'] ?? [];
$login = trim((string)($cfg['login'] ?? ''));
$password = (string)($cfg['password'] ?? '');
$imei = trim((string)($cfg['imei'] ?? ''));
$stationName = (string)($cfg['stationName'] ?? 'РУБИН 1');
$userId = trim((string)($cfg['userId'] ?? ''));

if ($login === '' || $password === '') {
  fail(503, 'Укажите email и пароль аккаунта sokolmeteo.com в data/weather_config.json (это НЕ пароль станции 2211).');
}

$cookieFile = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'rubin_sokol_cookies_' . md5($login) . '.txt';

function http_json($method, $url, $body = null, $cookieFile = null) {
  $ch = curl_init($url);
  $headers = ['Accept: application/json, */*', 'User-Agent: RubinGIS/1.0 (Sokol-M weather)'];
  if ($body !== null) {
    $headers[] = 'Content-Type: application/json';
  }
  curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 90,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_POSTFIELDS => $body,
    CURLOPT_COOKIEJAR => $cookieFile,
    CURLOPT_COOKIEFILE => $cookieFile,
  ]);
  $raw = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $err = curl_error($ch);
  curl_close($ch);
  if ($raw === false) {
    return [$code ?: 0, null, $err];
  }
  $json = json_decode($raw, true);
  return [$code, $json, $raw];
}

[$code, $json, $raw] = http_json(
  'POST',
  'https://sokolmeteo.com/platform/api/user/login',
  json_encode(['loginType' => 'email', 'login' => $login, 'password' => $password], JSON_UNESCAPED_UNICODE),
  $cookieFile
);

if ($code !== 200) {
  $msg = is_array($json) ? ($json['message'] ?? 'Неверный логин или пароль Sokolmeteo') : 'Ошибка входа Sokolmeteo';
  fail(401, $msg);
}

[$code, $json, $raw] = http_json(
  'POST',
  'https://sokolmeteo.com/api/device?start=0&count=100',
  '{}',
  $cookieFile
);
if ($code !== 200 || !is_array($json)) {
  fail(502, 'Не удалось получить список устройств Sokolmeteo');
}

$devices = $json['data'] ?? [];
$device = null;
foreach ($devices as $d) {
  if ((string)($d['imei'] ?? '') === $imei) { $device = $d; break; }
}
if (!$device && $userId) {
  foreach ($devices as $d) {
    if ((string)($d['userId'] ?? '') === $userId) { $device = $d; break; }
  }
}
if (!$device && count($devices) === 1) $device = $devices[0];
if (!$device) fail(404, 'Станция с IMEI ' . $imei . ' не найдена');

$deviceId = $device['id'] ?? $device['idAsString'] ?? '';
$end = new DateTime('now');
$start = (clone $end)->modify('-3 days');
$qs = http_build_query([
  'deviceId' => $deviceId,
  'startDate' => $start->format('d.m.Y'),
  'endDate' => $end->format('d.m.Y'),
  'parameters' => 't,HM,PR,WV,RN',
]);

[$code, $records, $raw] = http_json(
  'POST',
  'https://sokolmeteo.com/api/analytics/record?' . $qs,
  '',
  $cookieFile
);
if (!is_array($records)) $records = [];
$last = count($records) ? $records[count($records) - 1] : [];

$snapshot = $device['dataSnapshot'] ?? null;
if (is_string($snapshot)) {
  $decoded = json_decode($snapshot, true);
  if (is_array($decoded)) $snapshot = $decoded;
  else $snapshot = [];
}
if (!is_array($snapshot)) $snapshot = [];
$src = array_merge($snapshot, is_array($last) ? $last : []);

function pick_num($src, $keys) {
  foreach ($keys as $k) {
    if (!array_key_exists($k, $src) || $src[$k] === null || $src[$k] === '') continue;
    if (is_numeric($src[$k])) return floatval($src[$k]);
  }
  return null;
}

$temp = pick_num($src, ['t', 'T', 'temp']);
$humidity = pick_num($src, ['HM', 'hm', 'humidity']);
$pressure = pick_num($src, ['PR', 'pr', 'pressure']);
$wind = pick_num($src, ['WV', 'wv', 'wind']);
$rain = pick_num($src, ['RN', 'rn', 'rain', 'precipitation']);

$updatedAt = null;
$dateStr = $last['date'] ?? ($device['lastDataReceivedDt'] ?? null);
if ($dateStr) {
  try {
    $dt = new DateTime($dateStr);
    $updatedAt = (int)($dt->getTimestamp() * 1000);
  } catch (Exception $e) {
    $updatedAt = (int)(microtime(true) * 1000);
  }
} else {
  $updatedAt = (int)(microtime(true) * 1000);
}

$ageMin = max(0, (microtime(true) * 1000 - $updatedAt) / 60000);

echo json_encode([
  'source' => 'sokol',
  'stationName' => $device['name'] ?? $stationName,
  'imei' => $device['imei'] ?? $imei,
  'temp' => $temp === null ? null : round($temp, 1),
  'humidity' => $humidity === null ? null : round($humidity, 0),
  'pressure' => $pressure === null ? null : round($pressure, 1),
  'wind' => $wind === null ? null : round($wind, 1),
  'precipitation' => round(($rain === null ? 0 : $rain), 2),
  'description' => 'данные метеостанции Сокол-М',
  'isDemo' => false,
  'isStale' => $ageMin > 90,
  'updatedAt' => $updatedAt,
  'lastDataReceivedDt' => $device['lastDataReceivedDt'] ?? null,
  'ageMinutes' => (int)$ageMin,
], JSON_UNESCAPED_UNICODE);
