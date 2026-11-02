"""Independent, test-only Decimal calculation. No application code is imported."""
from decimal import Decimal as D, getcontext
from pathlib import Path
import json
getcontext().prec = 45
# Annual schedule is stated explicitly to provide an independent reference.
growth = [D('.08'), D('.06'), D('.04')] + [D('.04') + (D('.025') - D('.04')) * D(i) / D(7) for i in range(1, 8)]
margin = [D('.20') + D('.002') * D(i) for i in range(1, 11)]
productivity = [D(2)] * 3 + [D(2) - D(i) / D(7) for i in range(1, 8)]
sales = D(1000)
present_cash_flows = D(0)
for i, (g, m, s) in enumerate(zip(growth, margin, productivity), 1):
    old_sales = sales
    sales *= 1 + g
    investment = (sales - old_sales) / s
    operating_profit_after_tax = sales * m * D('.75')
    present_cash_flows += (operating_profit_after_tax - investment) / D('1.09') ** i
stable_profit = sales * D('1.025') * D('.22') * D('.75')
stable_cash = stable_profit * (1 - D('.025') / D('.12'))
present_terminal = stable_cash / D('.065') / D('1.09') ** 10
enterprise = present_cash_flows + present_terminal
equity = enterprise + 100 - 200 - 20 - 10 - 5
result = dict(enterpriseValue=str(enterprise), equityValue=str(equity), perShare=str(equity / 10), pvTerminal=str(present_terminal), terminalFcff=str(stable_cash))
target = Path(__file__).resolve().parents[1] / 'tests' / 'reference-dcf.json'
target.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
