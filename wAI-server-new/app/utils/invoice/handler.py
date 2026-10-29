def generate_invoice_link(invoice_tnx_id: str, customer_id: str, app_base_url: str) -> str:
    return f"{app_base_url}/invoice/{invoice_tnx_id}/pay?customer_id={customer_id}"
