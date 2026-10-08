import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestClient } from './helpers'

const BI = 'https://mybusinessbusinessinformation.googleapis.com/v1'

test('listLocations: readMask と pageSize=100 を付けて全ページ取得する', async () => {
  const { client, calls } = createTestClient([
    { status: 200, body: { locations: [{ name: 'locations/1', title: '渋谷店' }], nextPageToken: 'n' } },
    { status: 200, body: { locations: [{ name: 'locations/2', title: '新宿店' }] } },
  ])

  const locations = await client.listLocations('accounts/9', 'name,title,metadata.placeId')

  assert.deepEqual(locations.map(l => l.title), ['渋谷店', '新宿店'])
  assert.equal(calls[0].url, `${BI}/accounts/9/locations?pageSize=100&readMask=name%2Ctitle%2Cmetadata.placeId`)
  assert.equal(calls[1].url, `${BI}/accounts/9/locations?pageSize=100&pageToken=n&readMask=name%2Ctitle%2Cmetadata.placeId`)
})

test('getLocation: readMask を付けて 1 件取得する', async () => {
  const { client, calls } = createTestClient([
    { status: 200, body: { name: 'locations/1', profile: { description: '説明' } } },
  ])

  const location = await client.getLocation('locations/1', 'name,profile')

  assert.equal(location.profile?.description, '説明')
  assert.equal(calls[0].url, `${BI}/locations/1?readMask=name%2Cprofile`)
})

test('updateLocation: updateMask をカンマ区切りで付け、patch を JSON で PATCH する', async () => {
  const { client, calls } = createTestClient([
    { status: 200, body: { name: 'locations/1', websiteUri: 'https://example.com' } },
  ])

  const updated = await client.updateLocation(
    'locations/1',
    { websiteUri: 'https://example.com', profile: { description: '新しい説明' } },
    ['websiteUri', 'profile.description'],
  )

  assert.equal(updated.websiteUri, 'https://example.com')
  assert.equal(calls[0].method, 'PATCH')
  assert.equal(calls[0].url, `${BI}/locations/1?updateMask=websiteUri%2Cprofile.description`)
  assert.equal(calls[0].headers['Content-Type'], 'application/json')
  assert.deepEqual(calls[0].body, { websiteUri: 'https://example.com', profile: { description: '新しい説明' } })
})

test('updateLocation: updateMask が空なら API を呼ばずに例外', async () => {
  const { client, calls } = createTestClient([])
  await assert.rejects(client.updateLocation('locations/1', {}, []), /updateMask/)
  assert.equal(calls.length, 0)
})
