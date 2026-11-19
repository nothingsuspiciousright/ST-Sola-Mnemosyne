import test from 'node:test';
import assert from 'node:assert/strict';
import {explicitProviderBlockReason,isContentPolicyRejection,isGatewayTimeoutError} from '../src/core.js';
test('Gemini-style promptFeedback refusal is detected without candidate',()=>{
  const response={promptFeedback:{blockReason:'PROHIBITED_CONTENT'},usageMetadata:{promptTokenCount:4172},candidates:[]};
  assert.equal(explicitProviderBlockReason(response),'PROHIBITED_CONTENT');
  assert.equal(isContentPolicyRejection(response),true);
});
test('nested provider response can expose a clear refusal',()=>{
  const err={response:{data:{promptFeedback:{blockReason:'SAFETY'}}}};
  assert.equal(isContentPolicyRejection(err),true);
});
test('unknown reasons and 504 are not mistaken for safety refusal',()=>{
  assert.equal(explicitProviderBlockReason({promptFeedback:{blockReason:'OTHER'}}),'');
  assert.equal(isContentPolicyRejection({promptFeedback:{blockReason:'OTHER'}}),false);
  assert.equal(isContentPolicyRejection({response:{status:504},message:'Gateway Timeout'}),false);
  assert.equal(isGatewayTimeoutError({response:{status:504}}),true);
});
