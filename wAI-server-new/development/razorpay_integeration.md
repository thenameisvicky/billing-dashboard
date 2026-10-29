# Okay im rethinking the system design here are the questions i've got

## Questions

### 1. Which document's _id need to be sent as receipt among payemntattemptdetails, paymentreceiptdetails?

- Customer clicks pay from payment html page
- Backend API gets hit and order is created in razorpay
  1. paymentattemptdetails doc gets inseerted - with basic fields
  2. paymentreceiptdetails doc gets inserter -  with basic fields
  3. orderid attributed to invoice
  4. among paymentattemptdetails and paymentreceiptdetails document's which's _id needs to be sent as reciptid when creating and order in razorpay?
  5. Documentation says these, documentation has more noise
     - Order is an important step of the payment life cycle at Razorpay. When a customer clicks the pay button on your website or app, an order is created with a unique identifier. This contains details such as the transaction amount and currency. The order id secures the payment request and one cannot tamper with the order amount. Pass this order id to the Razorpay Checkout.You need to integrate your server with Orders API before proceeding with Razorpay Payment Gateway integration on your website or app.
     - Three states it seems created, attempted, paid | moment created is when first api hit and creating the API, after customer clicks pay and pays the created turns into attempted and after payment is captured it is turned into paid in razorpay as they mentioned in documentation.
     - Half baked info in watch out section - If an order is in an attempted state with the associated payment id in the authorised state, initiating another payment using the same order id is not allowed.
     - Also the orders API says - Receipt number that corresponds to this order, set for your internal reference. Can have a maximum length of 40 characters and has to be unique.
     - Will send other info like the line items in current invoice in notes
     - I also see this in error message from the documentation - Duplicate request. This request has already been processed.Error Status: 400An order with the same receipt value has already been created on this account. receipt is treated as an idempotency key, so a second create call with the same value is rejected.
     - Other errors list
       - Authentication failed.Error Status: 400 The API credentials passed in the API call differ from the ones generated on the Dashboard. Possible reasons: Different keys for test mode and live modes.Expired API key.

        The amount must be at least INR 1.00.
        Error Status: 400

        The amount specified is less than the minimum amount. Currency subunits, such as paise (in the case of INR), should always be greater than 100.

        The field name is required.

        Error Status: 400

        A mandatory field is missing.

        amount: must be no less than 0.

        Error Status: 400

        A negative amount was sent in the request body.

        The amount must be an integer.

        Error Status: 400

        amount was sent as a string, float or other non-integer type.

        Amount exceeds maximum amount allowed.

        Error Status: 400

        amount exceeds the per-order maximum configured for the account or currency.

        currency: validation_failure: BAD_REQUEST_INVALID_CURRENCY.

        Error Status: 400

        An unsupported currency value was sent (for example, XYZ) or a currency that is not enabled for your account.

        receipt: the length must be no more than 40.

        Error Status: 400

        receipt value exceeds 40 characters.

        The receipt: validation_failure: BAD_REQUEST_ENCODING_VALIDATION_FAILED.

        Error Status: 400

        receipt contains characters outside the supported encoding (for example, emoji or non-ASCII characters).

        first_payment_min_amount should be greater than or equal to 0.

        Error Status: 400

        first_payment_min_amount was set to a negative value while partial_payment: true.

        EOF.

        Error Status: 400

        The request body is malformed JSON. It may be truncated, missing a closing brace or otherwise unparseable.

        Duplicate request. This request has already been processed.

        Error Status: 400

        An order with the same receipt value has already been created on this account. receipt is treated as an idempotency key, so a second create call with the same value is rejected.

        Request failed because another order operation is in progress.

        Error Status: 400

        A concurrent create or update is already running against this order. Razorpay locks the order to prevent state corruption.

        Bank code provided is invalid.

        Error Status: 400

        For TPV (third-party validation) orders, the bank value passed is not a recognised IFSC bank code.

        The requested bank is not enabled for the merchant.

        Error Status: 400

        For TPV orders, the bank passed is valid but not enabled on your account.

        Bank code should be provided in input if account number is sent.

        Error Status: 400

        For TPV orders, an account_number was passed without the accompanying bank field.

        Account number is mandatory for this merchant.

        Error Status: 400

        Your account is configured to require an account_number on every order (TPV-enforced merchants), but the field is missing from the request.

  6. Request -
     -u [YOUR_KEY_ID]:[YOUR_KEY_SECRET] \
     -X POST <https://api.razorpay.com/v1/orders> \
     -H "content-type: application/json" \
     -d '{
          "amount": 5000,
          "currency": "INR",
          "receipt": "receipt#1",
          "notes": {
            "key1": "value3",
            "key2": "value2"
          }
        }
     Response success-

     ```json
     {"amount": 5000,
     "amount_due": 5000,
     "amount_paid": 0,
     "attempts": 0,
     "created_at": 1756455561,
     "currency": "INR",
     "entity": "order",
     "id": "order_RB58MiP5SPFYyM",
     "notes": {
         "key1": "value3",
         "key2": "value2"
     },
     "offer_id": null,
     "receipt": "receipt#1",
     "status": "created" }
     ```

  7. Biggest question here needs to be answered because following things depends on that
     "Which document's _id need to be sent as receipt among payemntattemptdetails, paymentreceiptdetails?"

- Cases
  1. Customer has worst network clicked 2 tims pay to retry payment, i need to create new order not attempt with existing order info right?
  2. After order's payment is captured i need to generate receipt and reduce from invoice amount.
  3. I'm confused now what are the cases might come and what are the existing staraight forward cases to handle.

## Findings & running notes took when reading razorpay integeration doc

### About integeration

- This integeration ain't a integeration partner, thsi is merchant meaning all the configs and keys are per company level and i could not access others because these APIs and keys needs to be generaeed by user and put in APP
- For MVP doing this merchant integeration later in MVP phase will do integeration partner integeration

### Webhook

- There is webhook setup for events a lot of events i've listed them below
- Webhook events can subscribe to
  - payment Events
  - payment.authorized
  - payment.failed
  - payment.captured
  - payment.dispute.created
  - payment.dispute.won
  - payment.dispute.lost
  - payment.dispute.closed
  - payment.dispute.under_review
  - payment.dispute.action_required
  - payment.downtime.started
  - payment.downtime.updated
  - payment.downtime.resolved
  - order Events
  - order.paid
  - order.notification.delivered
  - order.notification.failed
  - invoice Events
  - invoice.paid
  - invoice.partially_paid
  - invoice.expired
  - settlement Events
  - settlement.processed
  - fund_account Events
  - fund_account.validation.completed
  - fund_account.validation.failed
  - refund Events
  - refund.speed_changed
  - refund.processed
  - refund.failed
  - refund.created
  - account Events
  - account.instantly_activated
  - account.activated_kyc_pending
  - payment_link Events
  - payment_link.paid
  - payment_link.partially_paid
  - payment_link.expired
  - payment_link.cancelled
  - engage Events
  - engage.rewards.disabled
  - engage.rewards.enabled
  - engage.rewards.denomination_disabled
  - engage.rewards.denomination_enabled
  - engage.rewards.denomination_updated
  - engage.rewards.discount_updated
  - engage.rewards.termsandconditions_updated
  - engage.rewards.instructions_updated
  - engage.inventory.low_stock
  - engage.balance.low_balance  
- Webhook needs to be setup for now
  - Settlements events
  - Payment events
- What are these evetns and use cases i need some info for you to generate and give so that i can quickly cross check with razorpay docs
- For now after customer pays the wAI user the browser calls this function, this needs to fetch payments and match find the status and update
  @router.post("/payments/checkout-callback")
  async def checkout_callback(request: Request, payload: dict):
    order_id = str(payload.get("razorpay_order_id") or "")
    if not order_id:
        return JSONResponse({"status": "error", "message": "Missing razorpay_order_id"}, status_code=400)
    update_doc = {
        "updated_at": now_utc(),
        "gateway_response": payload.get("gateway_response") or payload,
    }
    if payload.get("razorpay_payment_id"):
        update_doc["razorpay_payment_id"] = payload.get("razorpay_payment_id")
    if payload.get("razorpay_signature"):
        update_doc["razorpay_signature"] = payload.get("razorpay_signature")
    if payload.get("failure_reason"):
        update_doc["status"] = "Failed"
        update_doc["failure_reason"] = payload.get("failure_reason")
    else:
        update_doc["status"] = "Submitted"
    result = await request.app.state.app_state.db.paymenteventdetails.update_one(
        {"razorpay_order_id": order_id, "provider": "razorpay"},
        {"$set": update_doc},
    )
    return JSONResponse({"status": "success" if result.matched_count else "error", "matched_count": result.matched_count})

### Fetch payments for order API

- Order id needs to be sent as path param
- response -

  ```json
  {"entity":"collection",
  "count":2,
  "items":[
    {
      "id":"pay_N8FUmetkCE2hZP",
      "entity":"payment",
      "amount":100,
      "currency":"INR",
      "status":"failed",
      "order_id":"order_N8FRN5zTm5S3wx",
      "invoice_id":null,
      "international":false,
      "method":"upi",
      "amount_refunded":0,
      "refund_status":null,
      "captured":false,
      "description":null,
      "card_id":null,
      "bank":null,
      "wallet":null,
      "vpa":"failure@razorpay",
      "email":"void@razorpay.com",
      "contact":"+919999999999",
      "notes":{
        "notes_key_1":"Tea, Earl Grey, Hot",
        "notes_key_2":"Tea, Earl Grey… decaf."
      },
      "fee":null,
      "tax":null,
      "error_code":"BAD_REQUEST_ERROR",
      "error_description":"Payment was unsuccessful due to a temporary issue. If amount got deducted, it will be refunded within 5-7 working days.",
      "error_source":"gateway",
      "error_step":"payment_response",
      "error_reason":"payment_failed",
      "acquirer_data":{
        "rrn":null
      },
      "created_at":1701688684,
      "upi":{
        "vpa":"failure@razorpay"
      }
    },
    {
      "id":"pay_N8FVRD1DzYzBh1",
      "entity":"payment",
      "amount":100,
      "currency":"INR",
      "status":"captured",
      "order_id":"order_N8FRN5zTm5S3wx",
      "invoice_id":null,
      "international":false,
      "method":"upi",
      "amount_refunded":0,
      "refund_status":null,
      "captured":true,
      "description":null,
      "card_id":null,
      "bank":null,
      "wallet":null,
      "vpa":"success@razorpay",
      "email":"void@razorpay.com",
      "contact":"+919999999999",
      "notes":{
        "notes_key_1":"Tea, Earl Grey, Hot",
        "notes_key_2":"Tea, Earl Grey… decaf."
      },
      "fee":2,
      "tax":0,
      "error_code":null,
      "error_description":null,
      "error_source":null,
      "error_step":null,
      "error_reason":null,
      "acquirer_data":{
        "rrn":"267567962619",
        "upi_transaction_id":"F5B66C7C07CA6FEAD77E956DC2FC7ABE"
      },
      "created_at":1701688721,
      "upi":{
        "vpa":"success@razorpay"
      }
    }
  ]}
  ```

### Payments module in razorpay

- Payment life cycle - created, authorized, captured, refunded, failed
- There is also something called late authorisation which happnes when external factors affect the payment system such as network issue - cna ignore this for now
- There is also autocapture, and refund settings i can see those in dashboard it is set to default - autocapture ON and refund settings Normal Refund
- There is also another case im gettin into how come a payment is authorized and did not captured ? i mean as i known and seen you text abouve you said payment is captured after authorized by bank immeidately in razorpay system right ?
- API list
  - Capture a payment API to capture a payment
  - Fetch a payment API to view details of a payment
  - Fetch multiple payments API to get details of all payments
  - Fetch payments based on orders API to get payments based on orders
  - Fetch card details for a payment API to get the card details for a payment
  - Update a payment API to update notes of a payment
  - Payment Downtime API API for payment downtime and webhooks
- I've explored the endpoints i think i needed only tell me if there is more endpoint needed

### <https://api.razorpay.com/v1/payments/:id/capture> - capture a payment API

- What the hell ? why do i have to capture ? the Razorpay does the capturing right ?or should i capture after receiving the webhook event when user pays?
- This is from description - Use this endpoint to change the payment status from authorized to captured. Attempting to capture a payment whose status is not authorized will produce an error.After the customer's bank authorises the payment, you must verify if the authorised amount deducted from the customer's account is the same as the amount paid by the customer on your website or app. You can configure automatic capture of payments on the Dashboard.
- Which means if i set auto capture then i don't have to manually capture payments right? for now gona keep auto capture which means can i skip this API?

### <https://api.razorpay.com/v1/payments/:id-> Fetch a payment with ID

- I think i can use this endpoint to verify the payment after user's payment event webhook hits my server, this will add extra validation to the webhook event so that i can update the invoice amount correctly

### Payment methods

- For now only integerating UPI payment so only explored UPI payment method
- Saw this - UPI Collect Flow Deprecated
According to NPCI guidelines, the UPI Collect flow is being deprecated effective 28 February 2026. Customers can no longer make payments or register UPI mandates by manually entering VPA/UPI id/mobile numbers.
Exemptions: UPI Collect will continue to be supported for:
MCC 6012 & 6211 (IPO and secondary market transactions).
iOS mobile app and mobile web transactions.
UPI Mandates (execute/modify/revoke operations only)
eRupi vouchers.
PACB businesses (cross-border/international payments).
Action Required:
If you are a new Razorpay user, use UPI Intent.
If you are an existing Razorpay user not covered by exemptions, you must migrate to UPI Intent or UPI QR code to continue accepting UPI payments. For detailed migration steps, refer to the migration documentation.
- Stopped exploring

### Other sections which i thought it'll be usefull

- Settlements
- Refunds
- Payment gateway
- Widgets
- Razorpay - Payments on Whatsapp
- Magic checkout
- Payment links
- Payment buttons
- Payment Pages
- Invoices
- QR codes
- Route
- Payments mobile app
- Third party validation

## Thoughts

- So when creating an invoice i need to generate the order for that invoice in razorpay as i generate the payment link?
- There is also a payment link module should i explore it?
- I need to setup webhooks to get the events  - how am i gonna handle authentication middleware ?
- currently the payment is in public API wth some one time generated token i need to secure it how do i?
- Priority is now the product bussienss cases not auth or infra
- How do i handle the webhook event's a

## Final system design

### The wAI flow

- Invoice creation generates payment link attaches it to invoice document (api and a public token mapped to invoice)
- User clicks the payment link -> wAI payment page opens
- User pays by clicking the pay button from wAI UI
  - paymentintentdetails document inserted , it's _id sent as receipt to order creation API in razorpay
  - Razorpay UI opens, user clicks pay and payment success
  - Success redirect -> wAI payments page waiting for payment confirmation
  - Webhook hits the backend with captured, paymentintentdetails -> marked as success
  - Reduced amount in invoice, paymentreceiptdetails document inserted receipt sent to customer in whatsapp
  - if user retries in same session the order id will be reused to make a attempt to pay
- New order is only created when customer pays a new installment, previous order paid, manual chash adjustment happned, previosu payment was abondant
