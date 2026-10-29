def is_valid_gstin(value: str) -> bool:
    gstin = value.strip().upper()
    if len(gstin) != 15:
        return False
    return (
        gstin[0:2].isdigit()
        and gstin[2:7].isalpha()
        and gstin[2:7].isupper()
        and gstin[7:11].isdigit()
        and gstin[11].isalpha()
        and gstin[11].isupper()
        and gstin[12].isalnum()
        and gstin[12] != "0"
        and gstin[13] == "Z"
        and gstin[14].isalnum()
    )


def is_missing_billing_state(value: str) -> bool:
    normalized = value.strip()
    return not normalized or normalized.lower() == "n/a"
