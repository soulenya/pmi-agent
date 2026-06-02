import sys

def trim_file(path, marker):
    with open(path, encoding='utf-8') as f:
        c = f.read()
    idx1 = c.find(marker)
    idx2 = c.find(marker, idx1 + 1) if idx1 >= 0 else -1
    if idx2 > 0:
        with open(path, 'w', encoding='utf-8') as g:
            g.write(c[:idx2])
        print(f'Trimmed {path} to {idx2} chars')
    else:
        print(f'No duplicate found in {path}')

path = sys.argv[1]
marker = sys.argv[2]
trim_file(path, marker)
