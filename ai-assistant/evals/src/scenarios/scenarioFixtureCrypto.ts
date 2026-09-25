/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/** Base64-encoded PEM request accepted by the certificates.k8s.io API. */
export const fixtureCsrRequest =
  'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURSBSRVFVRVNULS0tLS0KTUlIL01JR2xBZ0VBTUVNeElqQWdCZ05WQkFNTUdYUmxiR1Z0WlhSeWVTMWxlSEJwY21sdVp5MWpiR2xsYm5ReApIVEFiQmdOVkJBb01GSE41YzNSbGJUcGhkWFJvWlc1MGFXTmhkR1ZrTUZrd0V3WUhLb1pJemowQ0FRWUlLb1pJCnpqMERBUWNEUWdBRTA0aGZtdzlBejBZZVJ1T0ZVMnI2THpUUkRvRExWUnM5VHdQN3c2ZDhPNFp5OEZqQnNzc0UKNEU5SHpxQUJLa205QkUyRG52Mk1aU3NPSURvMGZpV2dRNkFBTUFvR0NDcUdTTTQ5QkFNQ0Ewa0FNRVlDSVFETQpPWFBFdXZrZWZuM3NpZ3BGWmtZN2xTek4yU0lSTEI3RWlndW5KY1AwTUFJaEFMMCsrVkRCTVRvYUtuV05NaWlrCnVIWTRqRHpUMGxVNG5IdkI5U0p6VUx1MQotLS0tLUVORCBDRVJUSUZJQ0FURSBSRVFVRVNULS0tLS0K';

/** Matching private key retained only by the trusted validation harness. */
export const fixtureCsrPrivateKey = Buffer.from(
  'LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1JR0hBZ0VBTUJNR0J5cUdTTTQ5QWdFR0NDcUdTTTQ5QXdFSEJHMHdhd0lCQVFRZ0ExSjZHSTU5MVZKZzM0NHcKVVhKTVpveFBxNWpEZlhST2hrMzBDbkhaNmtLaFJBTkNBQVRUaUYrYkQwRFBSaDVHNDRWVGF2b3ZOTkVPZ010VgpHejFQQS92RHAzdzdobkx3V01HeXl3VGdUMGZPb0FFcVNiMEVUWU9lL1l4bEt3NGdPalIrSmFCRAotLS0tLUVORCBQUklWQVRFIEtFWS0tLS0tCg==',
  'base64'
).toString('ascii');
