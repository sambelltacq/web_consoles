#!/bin/bash

mkdir -p -m 777 links
install_dir=$(pwd)

echo "Installing handler"
sed -i -r "s#^(install_dir=).*#\1$install_dir#" bin/handle_serial_event
chmod 755 bin/handle_serial_event
cp bin/handle_serial_event /usr/local/bin/

echo "Installing rules"
chmod 755 rules/99-serial_console.rules
cp rules/99-serial_console.rules /etc/udev/rules.d/

echo "Installing Misc"
chmod 755 config/.screenrc
cp config/.screenrc ~/

echo "Installing packages"
curl -fsSL https://deb.nodesource.com/setup_current.x | sudo -E bash -
apt install -y build-essential nodejs at screen expect

echo "Installing node modules"
npm install node-pty ws find-my-way

echo "Installing service"
sed -i -r "s#^(WorkingDirectory=).*#\1$install_dir#" config/web_consoles.service
sed -i -r "s#^(ExecStart=).*#\1${install_dir}/web_consoles.js#" config/web_consoles.service
cp config/web_consoles.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable web_consoles
systemctl start web_consoles